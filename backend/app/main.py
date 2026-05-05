from contextlib import asynccontextmanager
import json
import logging
import os
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import inspect, text

from app.api import alerts, audit, auth, dense_mode, device_sessions, meetings, patients, stats, users, pressure, device_monitor, events, heart_sound, lung_sound, passkeys, patient_stream
from app.api import patient_app as patient_app_api
from app.api import security as security_api
from app.core.config import get_settings
from app.core.limiter import limiter, get_strict_client_ip_rate_limit_key
from app.core.logging_config import configure_logging, redact_sensitive_data, reset_request_id, set_request_id
from app.db.session import SessionLocal
from app.middleware import IPBanMiddleware, SecurityAuditMiddleware, SecurityHeadersMiddleware
from app.models.device_error_log import DeviceErrorLog
from app.schemas.health import HealthCheckResponse, LiveHealthCheckResponse, RootResponse
from app.services import auth as auth_service
from app.services import meeting_presence as meeting_presence_service
from app.services.redis_runtime import (
    emit_runtime_alert_event,
    emit_runtime_diagnostics_event,
    evaluate_runtime_alert,
    get_runtime_diagnostics,
)
from app.services.security import record_login_attempt
from app.core.request_utils import get_client_ip

try:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
except ImportError:  # pragma: no cover - optional until dependency is installed
    sentry_sdk = None
    FastApiIntegration = None

try:
    from app.api import passkeys
    _PASSKEYS_IMPORT_ERROR: ModuleNotFoundError | None = None
except ModuleNotFoundError as exc:  # pragma: no cover - environment-specific optional dependency
    passkeys = None
    _PASSKEYS_IMPORT_ERROR = exc

logger = logging.getLogger(__name__)
DEVICE_INGEST_PATHS = {"/add_pressure", "/device/v1/pressure", "/device/v1/heart-sounds", "/device/v1/lung-sounds"}
_SENTRY_INITIALIZED = False


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
        # Redact the error message itself if it contains sensitive field markers
        # to prevent PII leakage into logs.
        scrubbed_message = redact_sensitive_data(message)
        errors.append(f"{loc}: {scrubbed_message}" if loc else scrubbed_message)

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
            logger.warning(
                "Failed to parse request body for device context in validation handler",
                extra={"path": request.url.path, "ip": _extract_client_ip(request)}
            )
            # keep fallback device_id

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


def backfill_bootstrap_privileged_roles_on_startup():
    try:
        bootstrap_emails = get_settings().super_admin_emails
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
                configured_count = (
                    len([email for email in bootstrap_emails if email.strip()])
                    if isinstance(bootstrap_emails, list)
                    else len([email for email in bootstrap_emails.split(",") if email.strip()])
                )
                if configured_count:
                    logger.warning(
                        "Bootstrap privileged-role backfill found no matching admin accounts for configured SUPER_ADMIN_EMAILS."
                    )
                else:
                    logger.info("Bootstrap privileged-role backfill skipped because SUPER_ADMIN_EMAILS is empty.")
    except Exception:
        logger.exception("Bootstrap privileged role backfill failed during startup.")
        raise


def _configure_sentry(settings) -> None:
    global _SENTRY_INITIALIZED
    if _SENTRY_INITIALIZED:
        return

    sentry_dsn = (os.getenv("SENTRY_DSN") or "").strip()
    if not sentry_dsn:
        return

    if sentry_sdk is None or FastApiIntegration is None:
        logger.warning(
            "SENTRY_DSN is configured but sentry-sdk is not installed. Skipping Sentry initialization."
        )
        return

    sentry_sdk.init(
        dsn=sentry_dsn,
        environment=(os.getenv("SENTRY_ENVIRONMENT") or settings.app_env).strip(),
        release=(os.getenv("SENTRY_RELEASE") or "").strip() or None,
        integrations=[FastApiIntegration()],
    )
    _SENTRY_INITIALIZED = True


def _log_startup_metadata(settings) -> None:
    version = (os.getenv("APP_VERSION") or os.getenv("SENTRY_RELEASE") or "unknown").strip() or "unknown"
    logger.info(
        "Application startup",
        extra={
            "app_name": settings.app_name,
            "environment": settings.app_env,
            "version": version,
            "pid": os.getpid(),
        },
    )


def _run_database_healthcheck() -> str:
    with SessionLocal() as db:
        db.execute(text("SELECT 1"))
    return "ok"


@asynccontextmanager
async def _application_lifespan(app: FastAPI):
    settings = get_settings()
    backfill_bootstrap_privileged_roles_on_startup()
    _log_startup_metadata(settings)
    meeting_presence_service.start_reconcile_worker()
    try:
        yield
    finally:
        meeting_presence_service.stop_reconcile_worker()


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.app_env)
    _configure_sentry(settings)
    docs_enabled = settings.should_enable_api_docs
    app = FastAPI(
        title=settings.app_name,
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
        lifespan=_application_lifespan,
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

    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next):
        request_id = str(uuid4())
        request.state.request_id = request_id
        request_id_token = set_request_id(request_id)

        try:
            response = await call_next(request)
        finally:
            reset_request_id(request_id_token)

        response.headers["X-Request-Id"] = request_id
        return response

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
    app.include_router(lung_sound.router)
    app.include_router(device_sessions.router)
    app.include_router(device_sessions.device_router)
    app.include_router(device_monitor.router)
    app.include_router(security_api.router)
    app.include_router(patient_app_api.router)
    app.include_router(events.router)
    app.include_router(passkeys.router)
    app.include_router(patient_stream.router)

    @app.get("/health", response_model=HealthCheckResponse)
    @limiter.limit("60/minute", key_func=get_strict_client_ip_rate_limit_key)
    def health_check(request: Request):
        checks = {
            "status": "ok",
            "db": "ok",
            "redis": "disabled",
            "redis_runtime": get_runtime_diagnostics(),
            "redis_runtime_alert": {
                "status": "ok",
                "should_alert": False,
                "reasons": [],
                "degraded_scope_threshold": max(int(settings.redis_runtime_degraded_scope_alert_threshold), 1),
                "operation_failure_threshold": max(int(settings.redis_runtime_operation_failure_alert_threshold), 1),
            },
        }
        status_code = 200

        try:
            checks["db"] = _run_database_healthcheck()
        except Exception:
            checks["db"] = "error"
            checks["status"] = "degraded"
            status_code = 503
            logger.exception("Database health check failed")

        checks["redis_runtime"] = get_runtime_diagnostics()
        checks["redis_runtime_alert"] = evaluate_runtime_alert(
            checks["redis_runtime"],
            degraded_scope_threshold=settings.redis_runtime_degraded_scope_alert_threshold,
            operation_failure_threshold=settings.redis_runtime_operation_failure_alert_threshold,
        )
        emit_runtime_diagnostics_event(logger)
        emit_runtime_alert_event(
            logger,
            diagnostics=checks["redis_runtime"],
            alert=checks["redis_runtime_alert"],
        )
        return JSONResponse(status_code=status_code, content=checks)

    @app.get("/health/live", response_model=LiveHealthCheckResponse)
    @limiter.limit("60/minute", key_func=get_strict_client_ip_rate_limit_key)
    def live_health_check(request: Request):
        return {"status": "ok"}

    @app.get("/", response_model=RootResponse)
    @limiter.limit("100/minute", key_func=get_strict_client_ip_rate_limit_key)
    def root(request: Request):
        return {"message": "Patient Management API", "status": "running"}

    return app


app = create_app()
