import logging
import json
import uuid
from binascii import Error as BinasciiError
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urlparse
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    verify_authentication_response,
    verify_registration_response,
    options_to_json,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    AuthenticatorTransport,
    UserVerificationRequirement,
    AuthenticatorAttachment,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
)

from app.core.config import LOOPBACK_ORIGIN_ALIASES, get_settings
from app.models.user import User
from app.models.user_passkey import UserPasskey
from app.schemas.passkey import (
    PasskeyAuthenticationOptionsResponse,
    PasskeyAuthenticationVerifyRequest,
    PasskeyRegistrationOptionsResponse,
    PasskeyRegistrationVerifyRequest,
    PasskeyListResponse,
    PasskeyOut,
)
from app.services import auth as auth_service
from app.services import passkey_store

router = APIRouter(prefix="/passkeys", tags=["passkeys"])
logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass(frozen=True)
class WebAuthnContext:
    origin: str
    rp_id: str


def _normalize_origin(value: str | None) -> str | None:
    if not value:
        return None

    normalized = value.strip().rstrip("/")
    if not normalized.startswith(("http://", "https://")):
        return None

    parsed = urlparse(normalized)
    if not parsed.scheme or not parsed.hostname:
        return None

    return normalized


def _configured_webauthn_origins() -> list[str]:
    origins: list[str] = []

    def add_origin(value: str | None) -> None:
        normalized = _normalize_origin(value)
        if not normalized or normalized in origins:
            return

        origins.append(normalized)
        for alias in LOOPBACK_ORIGIN_ALIASES.get(normalized, []):
            if alias not in origins:
                origins.append(alias)

    add_origin(settings.frontend_base_url)

    raw_cors_origins = settings.cors_origins
    cors_origins = (
        [origin.strip() for origin in raw_cors_origins.split(",") if origin.strip()]
        if isinstance(raw_cors_origins, str)
        else [origin.strip() for origin in raw_cors_origins if origin and origin.strip()]
    )
    for origin in cors_origins:
        add_origin(origin)

    return origins


def _derive_request_origin(request: Request) -> str | None:
    forwarded_proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip()
    forwarded_host = request.headers.get("x-forwarded-host", "").split(",")[0].strip()
    host = forwarded_host or request.headers.get("host", "").split(",")[0].strip()
    scheme = forwarded_proto or request.url.scheme
    if not host or not scheme:
        return None

    return _normalize_origin(f"{scheme}://{host}")


def _resolve_webauthn_context(request: Request) -> WebAuthnContext:
    configured_origin = _normalize_origin(settings.frontend_base_url)
    if not configured_origin:
        raise HTTPException(status_code=500, detail="Passkey frontend origin is not configured")

    allowed_origins = _configured_webauthn_origins()
    header_origin = _normalize_origin(request.headers.get("origin"))
    if header_origin:
        if header_origin not in allowed_origins:
            raise HTTPException(status_code=400, detail="Unsupported passkey origin")
        origin = header_origin
    else:
        request_origin = _derive_request_origin(request)
        origin = request_origin if request_origin in allowed_origins else configured_origin

    parsed_origin = urlparse(origin)
    rp_id = parsed_origin.hostname
    if not rp_id:
        raise HTTPException(status_code=500, detail="Passkey RP ID is not configured")

    return WebAuthnContext(origin=origin, rp_id=rp_id)


def _credential_field_is_present(payload: dict, *path: str) -> bool:
    current: object = payload
    for key in path:
        if not isinstance(current, dict):
            return False
        current = current.get(key)

    return isinstance(current, str) and bool(current.strip())


def _validate_registration_credential(credential: dict) -> dict:
    required_fields = [
        ("id",),
        ("rawId",),
        ("response", "attestationObject"),
        ("response", "clientDataJSON"),
    ]
    missing_fields = [
        ".".join(path) for path in required_fields if not _credential_field_is_present(credential, *path)
    ]

    if credential.get("type") != "public-key":
        missing_fields.append("type")

    if missing_fields:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "passkey_payload_invalid",
                "message": "Registration response is missing required WebAuthn fields.",
                "fields": missing_fields,
            },
        )

    response = credential.get("response")
    if isinstance(response, dict):
        transports = response.get("transports")
        if transports is not None and not isinstance(transports, list):
            response.pop("transports", None)

    return credential


def _validate_authentication_credential(credential: dict) -> dict:
    required_fields = [
        ("id",),
        ("rawId",),
        ("response", "authenticatorData"),
        ("response", "clientDataJSON"),
        ("response", "signature"),
    ]
    missing_fields = [
        ".".join(path) for path in required_fields if not _credential_field_is_present(credential, *path)
    ]

    if credential.get("type") != "public-key":
        missing_fields.append("type")

    if missing_fields:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "passkey_payload_invalid",
                "message": "Authentication response is missing required WebAuthn fields.",
                "fields": missing_fields,
            },
        )

    return credential


def _credential_id_to_bytes(value: str | bytes) -> bytes:
    if isinstance(value, bytes):
        return value

    normalized = value.strip()
    if not normalized:
        raise ValueError("Credential ID must be non-empty")

    if normalized.startswith("\\x"):
        return bytes.fromhex(normalized[2:])

    return base64url_to_bytes(normalized)


def _credential_id_to_canonical_string(value: str | bytes) -> str:
    if isinstance(value, bytes):
        return bytes_to_base64url(value)

    normalized = value.strip()
    if not normalized:
        raise ValueError("Credential ID must be non-empty")

    if normalized.startswith("\\x"):
        return bytes_to_base64url(bytes.fromhex(normalized[2:]))

    try:
        return bytes_to_base64url(base64url_to_bytes(normalized))
    except (ValueError, BinasciiError):
        return normalized


def _credential_id_lookup_candidates(value: str | bytes) -> list[str]:
    candidates: list[str] = []

    def add(candidate: str | None) -> None:
        if candidate and candidate not in candidates:
            candidates.append(candidate)

    if isinstance(value, str):
        add(value.strip())

    canonical = _credential_id_to_canonical_string(value)
    add(canonical)

    try:
        raw_bytes = _credential_id_to_bytes(value)
    except (ValueError, BinasciiError):
        raw_bytes = None

    if raw_bytes is not None:
        add(f"\\x{raw_bytes.hex()}")

    return candidates


def _build_credential_descriptor(passkey: UserPasskey) -> PublicKeyCredentialDescriptor:
    transports: list[AuthenticatorTransport] | None = None
    if isinstance(passkey.transports, list):
        parsed_transports: list[AuthenticatorTransport] = []
        for transport in passkey.transports:
            if not isinstance(transport, str):
                continue
            try:
                parsed_transports.append(AuthenticatorTransport(transport))
            except ValueError:
                continue
        if parsed_transports:
            transports = parsed_transports

    return PublicKeyCredentialDescriptor(
        id=_credential_id_to_bytes(passkey.credential_id),
        transports=transports,
    )

@router.get("/register-options", response_model=PasskeyRegistrationOptionsResponse)
def get_registration_options(
    request: Request,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    try:
        webauthn_context = _resolve_webauthn_context(request)
        
        existing_passkeys = db.scalars(
            select(UserPasskey).where(UserPasskey.user_id == current_user.id)
        ).all()
        exclude_credentials = [
            _build_credential_descriptor(passkey)
            for passkey in existing_passkeys
        ]

        user_name = str(current_user.email)
        display_name = f"{current_user.first_name or ''} {current_user.last_name or ''}".strip() or user_name

        options = generate_registration_options(
            rp_id=webauthn_context.rp_id,
            rp_name=settings.app_name,
            user_id=current_user.id.bytes,
            user_name=user_name,
            user_display_name=display_name,
            exclude_credentials=exclude_credentials,
            authenticator_selection=AuthenticatorSelectionCriteria(
                authenticator_attachment=AuthenticatorAttachment.PLATFORM,
                user_verification=UserVerificationRequirement.REQUIRED,
                resident_key=ResidentKeyRequirement.REQUIRED,
            ),
        )

        temp_sid = str(uuid.uuid4())
        passkey_store.store_challenge(
            temp_sid,
            options.challenge,
            origin=webauthn_context.origin,
            rp_id=webauthn_context.rp_id,
            user_verification=UserVerificationRequirement.REQUIRED.value,
        )

        response_payload = json.loads(options_to_json(options))
        response_payload["temp_sid"] = temp_sid
        return response_payload
    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to generate registration options")
        raise HTTPException(status_code=500, detail="Unable to generate passkey registration options")

@router.post("/register-verify", status_code=status.HTTP_201_CREATED)
def verify_registration(
    request: Request,
    payload: PasskeyRegistrationVerifyRequest,
    temp_sid: str,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    challenge_data = passkey_store.pop_challenge(temp_sid)
    if not challenge_data:
        raise HTTPException(status_code=400, detail="Registration challenge expired or not found")

    credential = _validate_registration_credential(payload.registration_response)
    challenge = base64url_to_bytes(challenge_data["challenge"])
    rp_id = challenge_data.get("rp_id") or _resolve_webauthn_context(request).rp_id
    origin = challenge_data.get("origin") or _resolve_webauthn_context(request).origin
    
    try:
        verification = verify_registration_response(
            credential=credential,
            expected_challenge=challenge,
            expected_rp_id=rp_id,
            expected_origin=origin,
            require_user_verification=True,
        )
        
        new_passkey = UserPasskey(
            user_id=current_user.id,
            credential_id=_credential_id_to_canonical_string(verification.credential_id),
            public_key=verification.credential_public_key,
            sign_count=verification.sign_count,
            name=(payload.name or "New Device").strip() or "New Device",
            transports=credential.get("response", {}).get("transports", []),
        )
        db.add(new_passkey)
        
        current_user.passkey_onboarding_dismissed = True
        db.add(current_user)
        db.commit()
        return {"message": "Passkey registered successfully"}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        logger.exception(
            "Passkey registration verification failed",
            extra={"user_id": str(current_user.id), "rp_id": rp_id, "origin": origin},
        )
        raise HTTPException(
            status_code=400,
            detail="Registration verification failed",
        )

@router.get("/login-options", response_model=PasskeyAuthenticationOptionsResponse)
def get_login_options(
    request: Request,
    email: str | None = None,
    db: Session = Depends(auth_service.get_db),
):
    try:
        webauthn_context = _resolve_webauthn_context(request)
        allow_credentials = []
        
        if email:
            user = db.scalar(select(User).where(User.email == email, User.deleted_at.is_(None)))
            if user:
                passkeys = db.scalars(select(UserPasskey).where(UserPasskey.user_id == user.id)).all()
                allow_credentials = [
                    _build_credential_descriptor(passkey)
                    for passkey in passkeys
                ]

        options = generate_authentication_options(
            rp_id=webauthn_context.rp_id,
            allow_credentials=allow_credentials,
            user_verification=UserVerificationRequirement.REQUIRED,
        )
        
        temp_sid = str(uuid.uuid4())
        passkey_store.store_challenge(
            temp_sid,
            options.challenge,
            origin=webauthn_context.origin,
            rp_id=webauthn_context.rp_id,
            user_verification=UserVerificationRequirement.REQUIRED.value,
        )
        
        resp = json.loads(options_to_json(options))
        resp["temp_sid"] = temp_sid
        return resp
    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to generate login options")
        raise HTTPException(status_code=500, detail="Unable to generate passkey login options")

@router.post("/login-verify")
def verify_login(
    request: Request,
    response: Response,
    payload: PasskeyAuthenticationVerifyRequest,
    temp_sid: str,
    db: Session = Depends(auth_service.get_db),
):
    challenge_data = passkey_store.pop_challenge(temp_sid)
    if not challenge_data:
        raise HTTPException(status_code=400, detail="Login challenge expired or not found")

    credential = _validate_authentication_credential(payload.authentication_response)
    challenge = base64url_to_bytes(challenge_data["challenge"])
    credential_id = credential.get("id")
    credential_id_candidates = _credential_id_lookup_candidates(credential_id)
    
    passkey = db.scalar(
        select(UserPasskey).where(UserPasskey.credential_id.in_(credential_id_candidates))
    )
    if not passkey:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail={"code": "passkey_not_registered", "message": "Passkey not recognized."}
        )

    user = passkey.user
    if not user or not user.is_active or user.deleted_at:
        raise HTTPException(status_code=401, detail="User account is inactive")

    rp_id = challenge_data.get("rp_id") or _resolve_webauthn_context(request).rp_id
    origin = challenge_data.get("origin") or _resolve_webauthn_context(request).origin

    try:
        verification = verify_authentication_response(
            credential=credential,
            expected_challenge=challenge,
            expected_rp_id=rp_id,
            expected_origin=origin,
            credential_public_key=passkey.public_key,
            credential_current_sign_count=passkey.sign_count,
            require_user_verification=True,
        )
        
        canonical_credential_id = _credential_id_to_canonical_string(credential_id)
        if passkey.credential_id != canonical_credential_id:
            passkey.credential_id = canonical_credential_id
        passkey.sign_count = verification.new_sign_count
        passkey.last_used_at = datetime.now(timezone.utc)
        db.add(passkey)
        
        login_response = auth_service.create_login_response(
            user,
            db=db,
            mfa_verified=True,
            mfa_authenticated_at=datetime.now(timezone.utc),
            auth_source="passkey",
        )
        
        from app.api.auth import _set_auth_cookie, _set_csrf_cookie
        _set_auth_cookie(response, login_response["access_token"], max_age_seconds=login_response["expires_in"])
        _set_csrf_cookie(response, max_age_seconds=login_response["expires_in"])
        
        db.commit()
        return login_response
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        logger.exception(
            "Passkey login verification failed",
            extra={
                "user_id": str(user.id),
                "credential_id": credential_id,
                "rp_id": rp_id,
                "origin": origin,
            },
        )
        raise HTTPException(status_code=400, detail="Login verification failed")

@router.get("/", response_model=PasskeyListResponse)
def list_passkeys(
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    passkeys = db.scalars(
        select(UserPasskey).where(UserPasskey.user_id == current_user.id).order_by(UserPasskey.created_at.desc())
    ).all()
    
    items = [
        PasskeyOut(
            id=str(p.id),
            name=p.name,
            created_at=p.created_at,
            last_used_at=p.last_used_at,
        )
        for p in passkeys
    ]
    return PasskeyListResponse(items=items, total=len(items))

@router.delete("/{passkey_id}")
def delete_passkey(
    passkey_id: UUID,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    passkey = db.scalar(
        select(UserPasskey).where(UserPasskey.id == passkey_id, UserPasskey.user_id == current_user.id)
    )
    if not passkey:
        raise HTTPException(status_code=404, detail="Passkey not found")
    
    db.delete(passkey)
    db.commit()
    return {"message": "Passkey deleted"}

@router.post("/onboarding/dismiss")
def dismiss_onboarding(
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    current_user.passkey_onboarding_dismissed = True
    current_user.last_onboarding_prompt_at = datetime.now(timezone.utc)
    db.add(current_user)
    db.commit()
    return {"message": "Onboarding dismissed"}
