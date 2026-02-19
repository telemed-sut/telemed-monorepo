from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.api import alerts, audit, auth, dense_mode, meetings, patients, stats, users, pressure, device_monitor
from app.api import security as security_api
from app.core.config import get_settings
from app.core.limiter import limiter
from app.db.session import SessionLocal
from app.middleware import IPBanMiddleware, SecurityAuditMiddleware, SecurityHeadersMiddleware
from app.services.security import record_login_attempt

settings = get_settings()

app = FastAPI(title=settings.app_name)
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    retry_after = exc.detail if exc.detail else "a few seconds"

    if request.method == "POST" and request.url.path.endswith("/auth/login"):
        try:
            body = await request.json()
            email = body.get("email")
            if email:
                ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "unknown")
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
            pass

    return JSONResponse(
        status_code=429,
        content={
            "error": "Too Many Requests",
            "message": f"คุณทำรายการเร็วเกินไป กรุณารอสักครู่ ({retry_after})",
            "detail": "Rate limit exceeded. Please slow down.",
            "retry_after": retry_after,
        },
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(IPBanMiddleware)
app.add_middleware(SecurityAuditMiddleware)

app.include_router(auth.router)
app.include_router(patients.router)
app.include_router(meetings.router)
app.include_router(users.router)
app.include_router(dense_mode.router)
app.include_router(alerts.router)
app.include_router(audit.router)
app.include_router(stats.router)
app.include_router(pressure.router)
app.include_router(device_monitor.router)
app.include_router(security_api.router)


@app.get("/health")
@limiter.limit("200/minute")
def health_check(request: Request):
    return {"status": "ok"}


@app.get("/")
@limiter.limit("100/minute")
def root(request: Request):
    return {"message": "Patient Management API", "status": "running"}
