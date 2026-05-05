import os

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings

settings = get_settings()
engine_options = {
    "pool_pre_ping": True,
    "future": True,
}


def _require_sslmode_for_remote_database_url(database_url: str) -> None:
    if database_url.startswith("sqlite"):
        return

    url = make_url(database_url)
    host = (url.host or "").strip().lower()
    if host in {"", "localhost", "127.0.0.1", "::1"}:
        return
    if os.path.exists("/.dockerenv") and host in {"db", "patient-db"}:
        return

    sslmode = url.query.get("sslmode")
    if not isinstance(sslmode, str) or not sslmode.strip():
        raise ValueError(
            "DATABASE_URL must include sslmode for non-local database connections."
        )


if not settings.database_url.startswith("sqlite"):
    engine_options.update(
        {
            "pool_size": settings.db_pool_size,
            "max_overflow": settings.db_max_overflow,
            "pool_recycle": settings.db_pool_recycle_seconds,
        }
    )

_require_sslmode_for_remote_database_url(settings.database_url)
engine = create_engine(settings.database_url, **engine_options)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)


def get_redis_connection_pool():
    return None


def get_redis_client():
    return None


def reset_redis_runtime_state() -> None:
    return None
