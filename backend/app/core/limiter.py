import hashlib

from fastapi import Request
from slowapi import Limiter

from app.core.config import get_settings
from app.core.request_utils import get_client_ip

settings = get_settings()


def _rate_limit_whitelist() -> set[str]:
    configured = settings.rate_limit_whitelist
    if isinstance(configured, str):
        return {item.strip() for item in configured.split(",") if item.strip()}
    return {item.strip() for item in configured if item and item.strip()}


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
    if client_ip in _rate_limit_whitelist():
        return None  # Returning None bypasses the rate limiter

    # 2. Check for Authorization header (User context)
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        # Hash the token so we don't keep raw bearer tokens in limiter keys or logs.
        return f"bearer:{hashlib.sha256(auth_header.encode('utf-8')).hexdigest()}"

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
    if client_ip in _rate_limit_whitelist():
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

    if client_ip in _rate_limit_whitelist():
        return None

    return f"ip:{client_ip}"


def get_strict_client_ip_rate_limit_key(request: Request):
    """
    Strict IP-based rate limit key for sensitive unauthenticated flows that
    must never bypass on whitelist entries.
    """
    client_ip = get_client_ip(request)
    return f"ip:{client_ip}"


# Initialize Limiter with support for Redis or Memory fallback
# Default limits:
# - Users/Dashboards: 200/minute (allows concurrent API calls)
# - Devices: 200/minute (allows frequent health checks/data pushes)
limiter = Limiter(
    key_func=get_real_user_key,
    default_limits=["200/minute"],
    storage_uri=settings.redis_url if settings.redis_url else "memory://",
)
