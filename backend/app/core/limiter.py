import hashlib

from fastapi import Request
from slowapi import Limiter

from app.core.config import get_settings
from app.core.request_utils import is_local_development_ip
from app.core.request_utils import get_client_ip

settings = get_settings()


def _rate_limit_whitelist() -> set[str]:
    configured = settings.rate_limit_whitelist
    whitelist = set()
    if isinstance(configured, str):
        whitelist = {item.strip() for item in configured.split(",") if item.strip()}
    else:
        whitelist = {item.strip() for item in configured if item and item.strip()}
    return whitelist


def _get_bearer_rate_limit_key(auth_header: str, client_ip: str) -> str:
    """
    Derive a rate-limit key from a bearer token.

    Security: Hashes the raw bearer token instead of decoding the JWT payload.
    Decoding unverified JWT payloads would allow an attacker to forge arbitrary
    `sub` values and bypass per-user throttling. Hashing the full token ensures
    each distinct token maps to a unique bucket — safe for this pre-auth layer.

    Trade-off: This buckets per-token rather than per-user, which is the correct
    choice here since auth hasn't run yet and we can't trust the payload.
    """
    token = auth_header.removeprefix("Bearer ").strip()
    if not token:
        return f"ip:{client_ip}"

    # Hash the raw token — stable per-token, no forgery risk
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()[:16]
    return f"tok:{token_hash}"


def get_real_user_key(request: Request):
    """
    Determine the rate limit key based on the request.

    Priority order:
    1. Whitelisted IP: Bypass limits entirely (return None).
    2. Authenticated User (Bearer Token): Allows multiple authenticated users behind same hospital IP.
    3. Physical Device (X-Device-Id): Allows multiple IoT devices behind same hospital IP.
    4. Fallback (IP Address): For unauthenticated public endpoints (login, etc).
    """
    client_ip = get_client_ip(request)

    # 1. Check for Whitelisted IP (Internal tools, Monitoring)
    if client_ip in _rate_limit_whitelist() or is_local_development_ip(client_ip):
        return None  # Returning None bypasses the rate limiter

    # 2. Check for Authorization header (User context)
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        return _get_bearer_rate_limit_key(auth_header, client_ip)

    # 3. Check for X-Device-Id header (IoT Device context)
    device_id = request.headers.get("X-Device-Id")
    if device_id:
        return f"device:{device_id}"

    # 4. Fallback to IP address for unauthenticated requests
    return f"ip:{client_ip}"


def get_failed_login_key(request: Request):
    """
    Strict rate limit key for failed login attempts.
    Always uses IP address to prevent brute-force attacks from a single source,
    regardless of the user they are trying to hack.
    """
    client_ip = get_client_ip(request)
    
    # 1. Check for Whitelisted IP (Internal tools, Monitoring)
    if client_ip in _rate_limit_whitelist() or is_local_development_ip(client_ip):
        return None  # Returning None bypasses the rate limiter

    return f"login:{client_ip}"


def get_strict_failed_login_key(request: Request):
    """
    Strict rate limit key for failed login attempts that must always apply,
    even for otherwise-whitelisted IPs.
    """
    client_ip = get_client_ip(request)
    return f"login:{client_ip}"


def get_client_ip_rate_limit_key(request: Request):
    """
    Generic strict IP-based rate limit key for unauthenticated sensitive flows
    such as password-reset request/confirm endpoints.
    """
    client_ip = get_client_ip(request)

    if client_ip in _rate_limit_whitelist() or is_local_development_ip(client_ip):
        return None

    return f"ip:{client_ip}"


def get_strict_client_ip_rate_limit_key(request: Request):
    """
    Strict IP-based rate limit key for sensitive unauthenticated flows that
    must never bypass on whitelist entries.
    """
    client_ip = get_client_ip(request)
    return f"ip:{client_ip}"


def get_device_ingest_rate_limit_key(request: Request):
    """
    Strict pre-auth limiter key for device ingest.

    Never trusts X-Device-Id before authentication, so rotating headers cannot
    evade the shared bucket for a single source IP.
    """
    client_ip = get_client_ip(request)
    return f"device-ingest:{client_ip}"


def _build_limiter_storage_configuration() -> tuple[str, dict[str, object]]:
    return "memory://", {}


storage_uri, storage_options = _build_limiter_storage_configuration()


limiter = Limiter(
    key_func=get_real_user_key,
    default_limits=["200/minute"],
    storage_uri=storage_uri,
    storage_options=storage_options,
)
