from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from app.api import alerts, audit, auth, dense_mode, meetings, patients, stats, users, pressure
from app.api import security as security_api
from app.core.config import get_settings
from app.middleware import SecurityHeadersMiddleware, IPBanMiddleware

settings = get_settings()
limiter = Limiter(key_func=get_remote_address, default_limits=["100/minute"])

app = FastAPI(title=settings.app_name)
app.state.limiter = limiter

@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"error": "Too Many Requests", "detail": "Rate limit exceeded", "retry_after": exc.detail}
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
app.include_router(security_api.router)

@app.get("/health")
@limiter.limit("200/minute")
def health_check(request: Request):
    return {"status": "ok"}

@app.get("/")
@limiter.limit("100/minute")
def root(request: Request):
    return {"message": "Patient Management API", "status": "running"}
