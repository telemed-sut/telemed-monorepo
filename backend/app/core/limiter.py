from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


def get_real_user_key(request: Request):
    """
    Determine the rate limit key based on the request.
    1. If the user is authenticated (has a Bearer token), use the token as the key.
       This allows multiple users behind the same IP (e.g., hospital NAT) to have independent limits.
    2. If not authenticated, fallback to IP address.
    """
    # Check for Authorization header
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        # Use the token itself as the unique key for the user session
        return auth_header
    
    # Fallback to IP address for unauthenticated requests
    return get_remote_address(request)


# Initialize Limiter with the smart key function
limiter = Limiter(key_func=get_real_user_key, default_limits=["200/minute"])
