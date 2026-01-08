from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, patients
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(patients.router)


@app.get("/health")
def health_check():
    return {"status": "ok"}
