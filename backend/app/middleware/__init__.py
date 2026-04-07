from contextlib import contextmanager
from collections import OrderedDict
import logging
import time
from datetime import datetime, timezone
from typing import Iterator, OrderedDict as OrderedDictType, Tuple
from uuid import UUID

from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from app.core.config import get_settings
from app.core.security import decode_token
from app.db.session import engine
from app.models.audit_log import AuditLog
from app.models.ip_ban import IPBan
from app.services.auth import get_db
from app.services.security import is_ip_whitelisted
from app.core.request_utils import get_client_ip as _get_client_ip

logger = logging.getLogger(__name__)
settings = get_settings()

# In-memory IP ban cache: ip -> (banned_until_timestamp, cached_at_timestamp)
_IP_BAN_CACHE_MAX_ENTRIES = 10_000
_ip_ban_cache: OrderedDictType[str, Tuple[float, float]] = OrderedDict()
_CACHE_TTL = 30  # seconds


def _get_ip_ban_cache_entry(ip: str, now: float) -> Tuple[float, float] | None:
    entry = _ip_ban_cache.get(ip)
    if entry is None:
        return None

    banned_until_ts, cached_at = entry
    if now - cached_at >= _CACHE_TTL:
        _ip_ban_cache.pop(ip, None)
        return None

    _ip_ban_cache.move_to_end(ip)
    return entry


def _set_ip_ban_cache_entry(ip: str, banned_until_ts: float, cached_at: float) -> None:
    if ip in _ip_ban_cache:
        _ip_ban_cache.pop(ip, None)

    _ip_ban_cache[ip] = (banned_until_ts, cached_at)

    while len(_ip_ban_cache) > _IP_BAN_CACHE_MAX_ENTRIES:
        _ip_ban_cache.popitem(last=False)


def _clear_ip_ban_cache_entry(ip: str) -> None:
    _ip_ban_cache.pop(ip, None)


@contextmanager
def _get_middleware_db_session(request: Request) -> Iterator[Session]:
    override = request.app.dependency_overrides.get(get_db)
    if override is not None:
        db_gen = override()
        db = next(db_gen)
        try:
            yield db
        finally:
            try:
                next(db_gen)
            except StopIteration:
                pass
        return

    db = Session(engine)
    try:
        yield db
    finally:
        db.close()




class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        csp_policy = (
            "default-src 'self'; "
            "base-uri 'self'; "
            "frame-ancestors 'none'; "
            "object-src 'none'; "
            "form-action 'self'; "
            "img-src 'self' data: https:; "
            "style-src 'self' 'unsafe-inline'; "
            "script-src 'self' 'unsafe-inline'; "
            "connect-src 'self' https: wss:"
        )

        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = csp_policy

        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            response.headers["Cache-Control"] = "no-store"

        return response


def _extract_actor_id(request: Request) -> UUID | None:
    raw_auth = request.headers.get("authorization", "")
    token = None
    if raw_auth.lower().startswith("bearer "):
        token = raw_auth.split(" ", 1)[1].strip()
    if not token:
        token = request.cookies.get(settings.auth_cookie_name)
    if not token:
        return None
    try:
        payload = decode_token(token)
    except Exception:
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    try:
        return UUID(str(user_id))
    except (TypeError, ValueError):
        return None


class SecurityAuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)

        if response.status_code != 403:
            return response

        path = request.url.path
        if path in {"/health", "/"} or path.startswith("/docs") or path.startswith("/openapi"):
            return response

        ip_address = _get_client_ip(request)
        actor_id = _extract_actor_id(request)
        details = {
            "method": request.method,
            "path": path,
            "status_code": response.status_code,
            "query": request.url.query,
            "user_agent": request.headers.get("user-agent", "")[:300],
        }

        try:
            with _get_middleware_db_session(request) as db:
                db.add(
                    AuditLog(
                        user_id=actor_id,
                        action="http_403_denied",
                        resource_type="http_request",
                        details=details,
                        ip_address=ip_address,
                        is_break_glass=False,
                        status="failure",
                    )
                )
                db.commit()
        except Exception:
            logger.exception("Failed to write 403 audit log for %s", path)

        return response


class IPBanMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        ip = _get_client_ip(request)

        if is_ip_whitelisted(ip):
            return await call_next(request)

        # Check in-memory cache first
        now = time.time()
        cached_entry = _get_ip_ban_cache_entry(ip, now)
        if cached_entry is not None:
            banned_until_ts, _cached_at = cached_entry
            if banned_until_ts > now:
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Access denied. Your IP has been temporarily blocked."},
                )

        # Check DB
        try:
            with _get_middleware_db_session(request) as db:
                from sqlalchemy import select as sa_select
                ban = db.scalar(sa_select(IPBan).where(IPBan.ip_address == ip))
                if ban:
                    if ban.banned_until:
                        banned_until = ban.banned_until
                        if banned_until.tzinfo is None:
                            banned_until = banned_until.replace(tzinfo=timezone.utc)

                        if banned_until > datetime.now(timezone.utc):
                            _set_ip_ban_cache_entry(ip, banned_until.timestamp(), now)
                            return JSONResponse(
                                status_code=403,
                                content={"detail": "Access denied. Your IP has been temporarily blocked."},
                            )
                        else:
                            db.delete(ban)
                            db.commit()
                            _clear_ip_ban_cache_entry(ip)
                    else:
                        # Permanent ban (banned_until is None)
                        _set_ip_ban_cache_entry(ip, now + 86400, now)
                        return JSONResponse(
                            status_code=403,
                            content={"detail": "Access denied. Your IP has been blocked."},
                        )
        except Exception:
            logger.exception("Error checking IP ban for %s", ip)

        return await call_next(request)
