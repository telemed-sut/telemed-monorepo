import json
import logging

from fastapi import FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import inspect
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api import alerts, audit, auth, dense_mode, meetings, patients, stats, users, pressure, device_monitor, events, heart_sound
from app.api import patient_app as patient_app_api
from app.api import security as security_api
from app.core.config import get_settings
from app.core.limiter import limiter
from app.core.logging_config import configure_logging
from app.db.session import SessionLocal
from app.middleware import IPBanMiddleware, SecurityAuditMiddleware, SecurityHeadersMiddleware
from app.models.device_error_log import DeviceErrorLog
from app.services import auth as auth_service
from app.services import meeting_presence as meeting_presence_service
from app.services.security import record_login_attempt
from app.core.request_utils import get_client_ip

logger = logging.getLogger(__name__)
DEVICE_INGEST_PATHS = {"/add_pressure", "/device/v1/pressure", "/device/v1/heart-sounds"}


async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    retry_after = exc.detail if exc.detail else "a few seconds"

    if request.method == "POST" and request.url.path.endswith("/auth/login"):
        try:
            body = await request.json()
            email = body.get("email")
            if email:
                ip = get_client_ip(request)
                with SessionLocal() as db:
                    record_login_attempt(
                        db,
                        ip,
                        email,
                        success=False,
                        details="Rate Limit Exceeded",
                    )
                    db.commit()
        except Exception:
            logger.warning("Failed to record rate-limited login attempt", exc_info=True)

    return JSONResponse(
        status_code=429,
        content={
            "error": "Too Many Requests",
            "message": f"คุณทำรายการเร็วเกินไป กรุณารอสักครู่ ({retry_after})",
            "detail": "Rate limit exceeded. Please slow down.",
            "retry_after": retry_after,
        },
    )


_extract_client_ip = get_client_ip

def _format_validation_summary(exc: RequestValidationError, max_items: int = 6) -> str:
    errors = []
    for err in exc.errors():
        loc = ".".join(str(part) for part in err.get("loc", []) if part != "body")
        message = str(err.get("msg", "invalid value"))
        errors.append(f"{loc}: {message}" if loc else message)

    if not errors:
        return "invalid_request_payload"

    summary = " | ".join(errors[:max_items])
    return summary[:1000]


async def validation_error_handler(request: Request, exc: RequestValidationError):
    if request.method == "POST" and request.url.path in DEVICE_INGEST_PATHS:
        device_id = (request.headers.get("x-device-id") or "").strip() or "unknown"

        try:
            raw_body = await request.body()
            if raw_body:
                payload = json.loads(raw_body.decode("utf-8"))
                if isinstance(payload, dict):
                    payload_device_id = payload.get("device_id")
                    if isinstance(payload_device_id, str) and payload_device_id.strip() and device_id == "unknown":
                        device_id = payload_device_id.strip()
        except Exception:
            # keep fallback device_id
            pass

        try:
            with SessionLocal() as db:
                db.add(
                    DeviceErrorLog(
                        device_id=device_id,
                        error_message=f"VALIDATION_FAILED:{_format_validation_summary(exc)}",
                        ip_address=_extract_client_ip(request),
                        endpoint=str(request.url),
                    )
                )
                db.commit()
        except Exception:
            logger.exception("Failed to write validation log for device ingest path %s", request.url.path)

    return await request_validation_exception_handler(request, exc)

def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.app_env)
    docs_enabled = settings.should_enable_api_docs
    app = FastAPI(
        title=settings.app_name,
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
    )
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, rate_limit_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_middleware(SlowAPIMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=[
            "Content-Type",
            "Authorization",
            "X-Device-Id",
            "X-Device-Nonce",
            "X-Device-Timestamp",
            "X-Device-Signature",
        ],
    )
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(IPBanMiddleware)
    app.add_middleware(SecurityAuditMiddleware)

    allowed_hosts = settings.resolved_allowed_hosts
    if allowed_hosts:
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)

    @app.on_event("startup")
    def backfill_bootstrap_privileged_roles_on_startup():
        try:
            with SessionLocal() as db:
                bind = db.get_bind()
                if bind is None or not inspect(bind).has_table("users"):
                    logger.info("Skipping bootstrap privileged-role backfill because the users table is not available yet.")
                    return
                if not inspect(bind).has_table("user_privileged_role_assignments"):
                    logger.info(
                        "Skipping bootstrap privileged-role backfill because the user_privileged_role_assignments table is not available yet."
                    )
                    return
                created = auth_service.backfill_bootstrap_privileged_roles(db)
                if created:
                    db.commit()
                    logger.info("Backfilled %s bootstrap privileged role assignment(s) from SUPER_ADMIN_EMAILS.", created)
                else:
                    db.rollback()
        except Exception:
            logger.exception("Bootstrap privileged role backfill failed during startup.")
            raise

    @app.on_event("startup")
    def start_meeting_presence_reconcile_worker():
        meeting_presence_service.start_reconcile_worker()

    @app.on_event("shutdown")
    def stop_meeting_presence_reconcile_worker():
        meeting_presence_service.stop_reconcile_worker()

    app.include_router(auth.router)
    app.include_router(patients.router)
    app.include_router(meetings.router)
    app.include_router(users.router)
    app.include_router(dense_mode.router)
    app.include_router(alerts.router)
    app.include_router(audit.router)
    app.include_router(stats.router)
    app.include_router(pressure.router)
    app.include_router(heart_sound.router)
    app.include_router(device_monitor.router)
    app.include_router(security_api.router)
    app.include_router(patient_app_api.router)
    app.include_router(events.router)

    @app.get("/health")
    @limiter.limit("200/minute")
    def health_check(request: Request):
        return {"status": "ok"}

    @app.get("/")
    @limiter.limit("100/minute")
    def root(request: Request):
        return {"message": "Patient Management API", "status": "running"}

    return app


app = create_app()
