"""
Shared request utility functions.

Centralized helpers for extracting information from FastAPI requests,
ensuring consistent behavior across all API routes and middleware.
"""

from fastapi import Request

from app.core.config import get_settings

__all__ = ["get_client_ip"]

settings = get_settings()


def get_client_ip(request: Request) -> str:
    """Extract the real client IP address from a request.

    Trusts proxy forwarding headers only when the direct remote host is in
    ``TRUSTED_PROXY_IPS``. Otherwise it returns ``request.client.host``.

    Trusted-proxy header order:
      1. Cloudflare's ``CF-Connecting-IP`` (set by Cloudflare proxy)
      2. ``X-Forwarded-For`` first entry (standard reverse-proxy header)
      3. Direct ``request.client.host`` as fallback

    Returns ``"unknown"`` when no client information is available.
    """
    remote_host = request.client.host if request.client else "unknown"
    trusted_proxies = settings.trusted_proxy_ips
    if isinstance(trusted_proxies, str):
        trusted_proxy_set = {item.strip() for item in trusted_proxies.split(",") if item.strip()}
    else:
        trusted_proxy_set = {item.strip() for item in trusted_proxies if item and item.strip()}

    if remote_host in trusted_proxy_set:
        cf_ip = request.headers.get("cf-connecting-ip")
        if cf_ip:
            return cf_ip.strip()

        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip()

    return remote_host
