from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

try:
    from app.api import auth, patients
    from app.core.config import get_settings
    HAS_DEPENDENCIES = True
    settings = get_settings()
except ImportError as e:
    print(f"Import error: {e}")
    HAS_DEPENDENCIES = False
    settings = None
except Exception as e:
    print(f"Config error: {e}")
    HAS_DEPENDENCIES = False
    settings = None

# Initialize rate limiter with in-memory storage
# Key function uses client IP address for rate limiting
limiter = Limiter(key_func=get_remote_address, default_limits=["100/minute"])

app = FastAPI(title=settings.app_name if settings else "Patient Management API")

# Add rate limiter to app state for use in routes
app.state.limiter = limiter

# Custom rate limit exceeded handler with informative message
@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={
            "error": "Too Many Requests",
            "detail": f"Rate limit exceeded. Please try again later.",
            "retry_after": exc.detail
        }
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if HAS_DEPENDENCIES and settings:
    try:
        app.include_router(auth.router)
        app.include_router(patients.router)
    except Exception as e:
        print(f"Router error: {e}")

@app.get("/health")
@limiter.limit("200/minute")  # Health check can be called more frequently
def health_check(request: Request):
    return {"status": "ok"}

@app.get("/")
@limiter.limit("100/minute")
def root(request: Request):
    return {"message": "Patient Management API", "status": "running", "dependencies": HAS_DEPENDENCIES}
