from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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

app = FastAPI(title=settings.app_name if settings else "Patient Management API")

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
def health_check():
    return {"status": "ok"}

@app.get("/")
def root():
    return {"message": "Patient Management API", "status": "running", "dependencies": HAS_DEPENDENCIES}
