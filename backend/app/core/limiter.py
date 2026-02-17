from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import get_settings

settings = get_settings()


def get_real_user_key(request: Request):
    """
    Determine the rate limit key based on the request.

    Priority order:
    1. Whitelisted IP: Bypass limits entirely (return None).
    2. Authenticated User (Bearer Token): Allows multiple staff behind same hospital IP.
    3. Physical Device (X-Device-Id): Allows multiple IoT devices behind same hospital IP.
    4. Fallback (IP Address): For unauthenticated public endpoints (login, etc).
    """
    client_ip = request.client.host if request.client else "127.0.0.1"
    # print(f"DEBUG: RealUserKey IP={client_ip} Whitelisted={client_ip in settings.rate_limit_whitelist}")

    # 1. Check for Whitelisted IP (Internal tools, Monitoring)
    if settings.rate_limit_whitelist and client_ip in settings.rate_limit_whitelist:
        return None  # Returning None bypasses the rate limiter

    # 2. Check for Authorization header (User context)
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        # Use the token itself as the unique key for the user session
        return auth_header

    # 3. Check for X-Device-Id header (IoT Device context)
    device_id = request.headers.get("X-Device-Id")
    if device_id:
        return f"device:{device_id}"

    # 4. Fallback to IP address for unauthenticated requests
    return get_remote_address(request)


def get_failed_login_key(request: Request):
    """
    Strict rate limit key for failed login attempts.
    Always uses IP address to prevent brute-force attacks from a single source,
    regardless of the user they are trying to hack.
    """
    client_ip = request.client.host if request.client else "127.0.0.1"
    
    # 1. Check for Whitelisted IP (Internal tools, Monitoring)
    if settings.rate_limit_whitelist and client_ip in settings.rate_limit_whitelist:
        return None  # Returning None bypasses the rate limiter

    return get_remote_address(request)


# Initialize Limiter with support for Redis or Memory fallback
# Default limits:
# - Users/Dashboards: 200/minute (allows concurrent API calls)
# - Devices: 200/minute (allows frequent health checks/data pushes)
limiter = Limiter(
    key_func=get_real_user_key,
    default_limits=["200/minute"],
    storage_uri=settings.redis_url if settings.redis_url else "memory://",
)
