import base64
import hashlib
import logging
import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

import httpx
from jose import jwk, jwt
from jose.utils import base64url_decode

from app.core.config import get_settings

logger = logging.getLogger(__name__)
_metadata_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_jwks_cache: dict[str, tuple[float, dict[str, Any]]] = {}


class AdminSsoConfigurationError(RuntimeError):
    pass


class AdminSsoExchangeError(RuntimeError):
    pass


@dataclass(frozen=True)
class AdminSsoIdentity:
    email: str
    email_verified: bool
    auth_time: datetime | None
    amr: tuple[str, ...]
    groups: tuple[str, ...]
    mfa_verified: bool
    id_token: str | None
    provider: str
    claims: dict[str, Any]


def is_enabled() -> bool:
    return bool(get_settings().admin_oidc_enabled)


def is_enforced() -> bool:
    settings = get_settings()
    return bool(settings.admin_oidc_enabled and settings.admin_oidc_enforced)


def get_status_payload() -> dict[str, Any]:
    settings = get_settings()
    enabled = bool(settings.admin_oidc_enabled)
    return {
        "enabled": enabled,
        "provider": settings.admin_oidc_provider_name if enabled else None,
        "enforced_for_admin": bool(enabled and settings.admin_oidc_enforced),
        "login_path": "/api/auth/admin/sso/login" if enabled else None,
        "logout_path": "/api/auth/admin/sso/logout" if enabled else None,
    }


def build_authorize_url(*, state_token: str, nonce: str, code_challenge: str) -> str:
    settings = get_settings()
    if not settings.admin_oidc_enabled:
        raise AdminSsoConfigurationError("Admin SSO is disabled.")

    metadata = _fetch_metadata()
    authorization_endpoint = str(metadata.get("authorization_endpoint") or "").strip()
    if not authorization_endpoint:
        raise AdminSsoConfigurationError("OIDC metadata is missing authorization_endpoint.")

    query = urlencode(
        {
            "client_id": settings.admin_oidc_client_id,
            "response_type": "code",
            "redirect_uri": settings.admin_oidc_redirect_uri,
            "scope": " ".join(settings.admin_oidc_scopes),
            "state": state_token,
            "nonce": nonce,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
    )
    return f"{authorization_endpoint}?{query}"


def complete_callback(*, code: str, expected_nonce: str, code_verifier: str) -> AdminSsoIdentity:
    settings = get_settings()
    if not settings.admin_oidc_enabled:
        raise AdminSsoConfigurationError("Admin SSO is disabled.")

    metadata = _fetch_metadata()
    token_payload = _exchange_code_for_tokens(code=code, metadata=metadata, code_verifier=code_verifier)
    id_token = _as_optional_str(token_payload.get("id_token"))
    if not id_token:
        raise AdminSsoExchangeError("OIDC token response did not include an id_token.")

    verified_claims = _verify_id_token(
        id_token=id_token,
        jwks_uri=str(metadata.get("jwks_uri") or ""),
        expected_nonce=expected_nonce,
    )
    access_token = _as_optional_str(token_payload.get("access_token"))
    if not access_token:
        raise AdminSsoExchangeError("OIDC token response did not include an access_token.")

    userinfo = _fetch_userinfo(access_token=access_token, metadata=metadata)
    claims = {**userinfo, **verified_claims}

    email = (_as_optional_str(claims.get("email")) or "").strip().lower()
    if not email:
        raise AdminSsoExchangeError("OIDC claims did not include an email address.")

    email_verified = bool(claims.get("email_verified", True))
    auth_time = _coerce_datetime(claims.get("auth_time"))
    amr = _normalize_string_list(claims.get("amr"))
    groups = _normalize_string_list(claims.get("groups"))
    mfa_verified = _claims_indicate_mfa(claims, amr=amr)

    return AdminSsoIdentity(
        email=email,
        email_verified=email_verified,
        auth_time=auth_time,
        amr=amr,
        groups=groups,
        mfa_verified=mfa_verified,
        id_token=id_token,
        provider=settings.admin_oidc_provider_name,
        claims=claims,
    )


def build_logout_redirect_url(*, id_token_hint: str | None) -> str | None:
    settings = get_settings()
    if not settings.admin_oidc_enabled:
        return None

    metadata = _fetch_metadata()
    end_session_endpoint = _as_optional_str(metadata.get("end_session_endpoint"))
    if not end_session_endpoint:
        return None

    query: dict[str, str] = {}
    if id_token_hint:
        query["id_token_hint"] = id_token_hint
    if settings.admin_oidc_post_logout_redirect_uri:
        query["post_logout_redirect_uri"] = settings.admin_oidc_post_logout_redirect_uri

    return end_session_endpoint if not query else f"{end_session_endpoint}?{urlencode(query)}"


def reset_runtime_caches() -> None:
    _metadata_cache.clear()
    _jwks_cache.clear()


def generate_pkce_code_verifier() -> str:
    # RFC 7636 allows 43-128 chars from a restricted charset; urlsafe token is sufficient.
    return secrets.token_urlsafe(48)


def create_pkce_code_challenge(code_verifier: str) -> str:
    digest = hashlib.sha256(code_verifier.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def email_domain_allowed(email: str) -> bool:
    settings = get_settings()
    allowed = {
        domain.strip().lower()
        for domain in settings.admin_oidc_allowed_email_domains
        if isinstance(domain, str) and domain.strip()
    }
    if not allowed:
        return True
    _, _, domain = email.lower().partition("@")
    return bool(domain and domain in allowed)


def required_group_present(groups: tuple[str, ...]) -> bool:
    required_group = (get_settings().admin_oidc_required_group or "").strip().lower()
    if not required_group:
        return True
    return required_group in {group.lower() for group in groups}


def _exchange_code_for_tokens(*, code: str, metadata: dict[str, Any], code_verifier: str) -> dict[str, Any]:
    settings = get_settings()
    token_endpoint = str(metadata.get("token_endpoint") or "").strip()
    if not token_endpoint:
        raise AdminSsoConfigurationError("OIDC metadata is missing token_endpoint.")

    with httpx.Client(timeout=10.0) as client:
        response = client.post(
            token_endpoint,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.admin_oidc_redirect_uri,
                "client_id": settings.admin_oidc_client_id,
                "client_secret": settings.admin_oidc_client_secret,
                "code_verifier": code_verifier,
            },
            headers={"Accept": "application/json"},
        )

    if response.status_code >= 400:
        logger.warning("Admin SSO token exchange failed with %s", response.status_code)
        raise AdminSsoExchangeError("OIDC token exchange failed.")

    payload = response.json()
    if not isinstance(payload, dict):
        raise AdminSsoExchangeError("OIDC token exchange returned an invalid payload.")
    return payload


def _fetch_userinfo(*, access_token: str, metadata: dict[str, Any]) -> dict[str, Any]:
    userinfo_endpoint = str(metadata.get("userinfo_endpoint") or "").strip()
    if not userinfo_endpoint:
        raise AdminSsoConfigurationError("OIDC metadata is missing userinfo_endpoint.")

    with httpx.Client(timeout=10.0) as client:
        response = client.get(
            userinfo_endpoint,
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {access_token}",
            },
        )

    if response.status_code >= 400:
        logger.warning("Admin SSO userinfo fetch failed with %s", response.status_code)
        raise AdminSsoExchangeError("OIDC userinfo fetch failed.")

    payload = response.json()
    if not isinstance(payload, dict):
        raise AdminSsoExchangeError("OIDC userinfo payload is invalid.")
    return payload


def _fetch_metadata() -> dict[str, Any]:
    settings = get_settings()
    issuer_url = (settings.admin_oidc_issuer_url or "").rstrip("/")
    if not issuer_url:
        raise AdminSsoConfigurationError("ADMIN_OIDC_ISSUER_URL is required.")

    cache_ttl = settings.admin_oidc_cache_ttl_seconds
    cached = _metadata_cache.get(issuer_url)
    now = time.time()
    if cached and cached[0] > now:
        return cached[1]

    metadata_url = f"{issuer_url}/.well-known/openid-configuration"
    with httpx.Client(timeout=10.0) as client:
        response = client.get(metadata_url, headers={"Accept": "application/json"})

    if response.status_code >= 400:
        logger.warning("Admin SSO metadata fetch failed with %s", response.status_code)
        raise AdminSsoConfigurationError("Unable to load OIDC metadata.")

    payload = response.json()
    if not isinstance(payload, dict):
        raise AdminSsoConfigurationError("OIDC metadata response is invalid.")
    _metadata_cache[issuer_url] = (now + cache_ttl, payload)
    return payload


def _fetch_jwks(jwks_uri: str) -> dict[str, Any]:
    if not jwks_uri:
        raise AdminSsoConfigurationError("OIDC metadata is missing jwks_uri.")

    cache_ttl = get_settings().admin_oidc_cache_ttl_seconds
    cached = _jwks_cache.get(jwks_uri)
    now = time.time()
    if cached and cached[0] > now:
        return cached[1]

    with httpx.Client(timeout=10.0) as client:
        response = client.get(jwks_uri, headers={"Accept": "application/json"})

    if response.status_code >= 400:
        logger.warning("Admin SSO JWKS fetch failed with %s", response.status_code)
        raise AdminSsoConfigurationError("Unable to load OIDC signing keys.")

    payload = response.json()
    if not isinstance(payload, dict):
        raise AdminSsoConfigurationError("OIDC JWKS payload is invalid.")
    _jwks_cache[jwks_uri] = (now + cache_ttl, payload)
    return payload


def _verify_id_token(*, id_token: str, jwks_uri: str, expected_nonce: str) -> dict[str, Any]:
    settings = get_settings()
    header = jwt.get_unverified_header(id_token)
    claims = jwt.get_unverified_claims(id_token)
    if not isinstance(header, dict) or not isinstance(claims, dict):
        raise AdminSsoExchangeError("OIDC id_token is invalid.")

    key_id = _as_optional_str(header.get("kid"))
    jwks = _fetch_jwks(jwks_uri)
    keys = jwks.get("keys")
    if not isinstance(keys, list):
        raise AdminSsoExchangeError("OIDC JWKS payload is missing keys.")

    jwk_data = next(
        (
            item
            for item in keys
            if isinstance(item, dict) and _as_optional_str(item.get("kid")) == key_id
        ),
        None,
    )
    if jwk_data is None:
        raise AdminSsoExchangeError("Unable to find a matching OIDC signing key.")

    message, encoded_signature = id_token.rsplit(".", 1)
    decoded_signature = base64url_decode(encoded_signature.encode("utf-8"))
    key = jwk.construct(jwk_data)
    if not key.verify(message.encode("utf-8"), decoded_signature):
        raise AdminSsoExchangeError("OIDC id_token signature verification failed.")

    issuer = _as_optional_str(claims.get("iss"))
    if issuer != (settings.admin_oidc_issuer_url or "").rstrip("/"):
        raise AdminSsoExchangeError("OIDC id_token issuer mismatch.")

    audience = claims.get("aud")
    expected_audience = settings.admin_oidc_client_id
    if isinstance(audience, str):
        audiences = {audience}
    elif isinstance(audience, list):
        audiences = {str(item) for item in audience if isinstance(item, str)}
    else:
        audiences = set()
    if expected_audience not in audiences:
        raise AdminSsoExchangeError("OIDC id_token audience mismatch.")

    expiration = claims.get("exp")
    if not isinstance(expiration, (int, float)) or int(expiration) <= int(time.time()):
        raise AdminSsoExchangeError("OIDC id_token is expired.")

    nonce = _as_optional_str(claims.get("nonce"))
    if not nonce or nonce != expected_nonce:
        raise AdminSsoExchangeError("OIDC nonce validation failed.")

    return claims


def _claims_indicate_mfa(claims: dict[str, Any], *, amr: tuple[str, ...]) -> bool:
    acr = _as_optional_str(claims.get("acr"))
    normalized_amr = {entry.lower() for entry in amr}
    strong_markers = {
        "mfa",
        "otp",
        "totp",
        "webauthn",
        "hwk",
        "swk",
        "fido",
        "passkey",
    }
    if normalized_amr.intersection(strong_markers):
        return True
    if acr and "mfa" in acr.lower():
        return True
    return False


def _normalize_string_list(value: Any) -> tuple[str, ...]:
    if isinstance(value, list):
        return tuple(str(item).strip() for item in value if isinstance(item, str) and item.strip())
    if isinstance(value, str) and value.strip():
        return (value.strip(),)
    return ()


def _coerce_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc)
    return None


def _as_optional_str(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None
