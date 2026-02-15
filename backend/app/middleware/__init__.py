import logging
import time
from datetime import datetime, timezone
from typing import Dict, Tuple

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.ip_ban import IPBan
from app.services.security import is_ip_whitelisted

logger = logging.getLogger(__name__)
settings = get_settings()

# In-memory IP ban cache: ip -> (banned_until_timestamp, cached_at_timestamp)
_ip_ban_cache: Dict[str, Tuple[float, float]] = {}
_CACHE_TTL = 30  # seconds


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)

        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"

        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            response.headers["Cache-Control"] = "no-store"

        return response


class IPBanMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        ip = _get_client_ip(request)

        if is_ip_whitelisted(ip):
            return await call_next(request)

        # Check in-memory cache first
        now = time.time()
        if ip in _ip_ban_cache:
            banned_until_ts, cached_at = _ip_ban_cache[ip]
            if now - cached_at < _CACHE_TTL:
                if banned_until_ts > now:
                    return JSONResponse(
                        status_code=403,
                        content={"detail": "Access denied. Your IP has been temporarily blocked."},
                    )
            else:
                del _ip_ban_cache[ip]

        # Check DB
        try:
            db = SessionLocal()
            try:
                from sqlalchemy import select as sa_select
                ban = db.scalar(sa_select(IPBan).where(IPBan.ip_address == ip))
                if ban:
                    if ban.banned_until:
                        banned_until = ban.banned_until
                        if banned_until.tzinfo is None:
                            banned_until = banned_until.replace(tzinfo=timezone.utc)

                        if banned_until > datetime.now(timezone.utc):
                            _ip_ban_cache[ip] = (banned_until.timestamp(), now)
                            return JSONResponse(
                                status_code=403,
                                content={"detail": "Access denied. Your IP has been temporarily blocked."},
                            )
                        else:
                            db.delete(ban)
                            db.commit()
                    else:
                        # Permanent ban (banned_until is None)
                        _ip_ban_cache[ip] = (now + 86400, now)  # Cache for 24h
                        return JSONResponse(
                            status_code=403,
                            content={"detail": "Access denied. Your IP has been blocked."},
                        )
            finally:
                db.close()
        except Exception:
            logger.exception("Error checking IP ban for %s", ip)

        return await call_next(request)
