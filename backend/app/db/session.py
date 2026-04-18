import os
from typing import Any

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings

try:
    import redis
except ImportError:  # pragma: no cover - handled by runtime validation
    redis = None

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

_redis_connection_pool: Any | None = None
_redis_client: Any | None = None
_redis_url: str | None = None


def _get_configured_redis_url() -> str | None:
    return (settings.redis_url or "").strip() or None


def get_redis_connection_pool():
    redis_url = _get_configured_redis_url()
    if not redis_url:
        return None
    if redis is None:
        raise RuntimeError("The redis package is required when REDIS_URL is configured.")

    global _redis_connection_pool, _redis_url
    if _redis_connection_pool is not None and _redis_url == redis_url:
        return _redis_connection_pool

    _redis_connection_pool = redis.ConnectionPool.from_url(redis_url)
    _redis_url = redis_url
    return _redis_connection_pool


def get_redis_client():
    pool = get_redis_connection_pool()
    if pool is None:
        return None

    global _redis_client
    if _redis_client is not None:
        return _redis_client

    if redis is None:
        raise RuntimeError("The redis package is required when REDIS_URL is configured.")

    _redis_client = redis.Redis(connection_pool=pool)
    return _redis_client


def reset_redis_runtime_state() -> None:
    global _redis_connection_pool, _redis_client, _redis_url
    if _redis_connection_pool is not None and hasattr(_redis_connection_pool, "disconnect"):
        _redis_connection_pool.disconnect()
    _redis_connection_pool = None
    _redis_client = None
    _redis_url = None
