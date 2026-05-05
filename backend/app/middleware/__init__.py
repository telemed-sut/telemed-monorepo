from contextlib import contextmanager
import logging
from datetime import datetime, timezone
from typing import Iterator
from urllib.parse import parse_qsl
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
from app.services.auth import get_db
from app.services import security as security_service
from app.core.request_utils import get_client_ip as _get_client_ip

logger = logging.getLogger(__name__)
settings = get_settings()


def _build_sanitized_query_metadata(query: str) -> dict[str, object]:
    if not query:
        return {
            "query_present": False,
            "query_keys": [],
        }

    query_keys = sorted(
        {
            key.strip()
            for key, _value in parse_qsl(query, keep_blank_values=True)
            if key and key.strip()
        }
    )
    return {
        "query_present": bool(query_keys),
        "query_keys": query_keys,
    }


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
        path = request.url.path
        docs_paths = ("/docs", "/redoc", "/openapi")
        if path.startswith(docs_paths):
            csp_policy = (
                "default-src 'self'; "
                "base-uri 'self'; "
                "frame-ancestors 'none'; "
                "object-src 'none'; "
                "form-action 'self'; "
                "img-src 'self' data: https:; "
                "style-src 'self' 'unsafe-inline' https:; "
                "script-src 'self' 'unsafe-inline' https:; "
                "font-src 'self' data: https:; "
                "connect-src 'self' https:"
            )
        else:
            csp_policy = (
                "default-src 'none'; "
                "base-uri 'none'; "
                "frame-ancestors 'none'; "
                "object-src 'none'; "
                "form-action 'none'; "
                "img-src 'none'; "
                "style-src 'none'; "
                "script-src 'none'; "
                "font-src 'none'; "
                "manifest-src 'none'; "
                "connect-src 'self' https://*.blob.core.windows.net"
            )

        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "0"
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
    if payload.get("type") not in (None, "access"):
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

        # Log both 401 (Unauthorized) and 403 (Forbidden) to the audit log.
        if response.status_code not in {401, 403}:
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
            **_build_sanitized_query_metadata(request.url.query),
            "user_agent": request.headers.get("user-agent", "")[:300],
        }

        action_name = "http_403_denied" if response.status_code == 403 else "http_401_unauthorized"

        try:
            with _get_middleware_db_session(request) as db:
                db.add(
                    AuditLog(
                        user_id=actor_id,
                        action=action_name,
                        resource_type="http_request",
                        details=details,
                        ip_address=ip_address,
                        is_break_glass=False,
                        status="failure",
                    )
                )
                db.commit()
        except Exception:
            logger.exception("Failed to write %s audit log for %s", action_name, path)

        return response


class IPBanMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        ip = _get_client_ip(request)

        if security_service.is_ip_whitelisted(ip):
            return await call_next(request)

        try:
            with _get_middleware_db_session(request) as db:
                ban = security_service.check_ip_banned(db, ip)
                if ban:
                    if ban.banned_until is None:
                        return JSONResponse(
                            status_code=403,
                            content={"detail": "Access denied. Your IP has been blocked."},
                        )
                    banned_until = ban.banned_until
                    if banned_until.tzinfo is None:
                        banned_until = banned_until.replace(tzinfo=timezone.utc)
                    if banned_until > datetime.now(timezone.utc):
                        return JSONResponse(
                            status_code=403,
                            content={"detail": "Access denied. Your IP has been temporarily blocked."},
                        )
        except Exception:
            logger.exception("Error checking IP ban for %s", ip)

        return await call_next(request)
