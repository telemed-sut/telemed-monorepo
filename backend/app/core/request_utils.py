"""
Shared request utility functions.

Centralized helpers for extracting information from FastAPI requests,
ensuring consistent behavior across all API routes and middleware.
"""

from fastapi import Request

__all__ = ["get_client_ip"]


def get_client_ip(request: Request) -> str:
    """Extract the real client IP address from a request.

    Checks headers in priority order:
      1. Cloudflare's ``CF-Connecting-IP`` (set by Cloudflare proxy)
      2. ``X-Forwarded-For`` first entry (standard reverse-proxy header)
      3. Direct ``request.client.host`` as fallback

    Returns ``"unknown"`` when no client information is available.
    """
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip:
        return cf_ip.strip()

    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()

    return request.client.host if request.client else "unknown"
