from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.core.limiter import limiter

from app.api import alerts, audit, auth, dense_mode, meetings, patients, stats, users, pressure, device_monitor
from app.api import security as security_api
from app.core.config import get_settings
from app.middleware import SecurityHeadersMiddleware, IPBanMiddleware

settings = get_settings()

settings = get_settings()

# limiter imported from core

# Imports for rate limit logging
from app.db.session import SessionLocal
from app.services.security import record_login_attempt
from app.core.limiter import limiter

app = FastAPI(title=settings.app_name)
app.state.limiter = limiter
# Explicitly add SlowAPI middleware to set X-RateLimit-* headers
app.add_middleware(SlowAPIMiddleware)

@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    # Get retry value (e.g., "60 seconds")
    # Get retry value (e.g., "60 seconds")
    retry_after = exc.detail if exc.detail else "a few seconds"

    # Log failed login attempt if this was a login request
    # This allows admins to see "Blocked (Rate Limit)" in the security dashboard
    if request.method == "POST" and request.url.path.endswith("/auth/login"):
        try:
            # We need to read the body to get the email
            # Note: This might fail if the body is too large or malformed, but it's worth a try for logging
            body = await request.json()
            email = body.get("email")
            
            if email:
                ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "unknown")
                
                # Use a separate session for logging since we are in an exception handler
                with SessionLocal() as db:
                    record_login_attempt(
                        db, 
                        ip, 
                        email, 
                        success=False, 
                        details="Rate Limit Exceeded"
                    )
                    db.commit()
        except Exception:
            # If logging fails (e.g. body parsing error), we just ignore it to ensure the 429 response is still sent
            pass

    return JSONResponse(
        status_code=429,
        content={
            "error": "Too Many Requests",
            "message": f"คุณทำรายการเร็วเกินไป กรุณารอสักครู่ ({retry_after})",
            "detail": "Rate limit exceeded. Please slow down.",
            "retry_after": retry_after
        }
    )

# Middleware stack (order matters: last added = first executed)
# 1. CORS (innermost - handles preflight)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# 2. Security headers
app.add_middleware(SecurityHeadersMiddleware)
# 3. IP ban check (outermost - blocks banned IPs before anything else)
app.add_middleware(IPBanMiddleware)

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
