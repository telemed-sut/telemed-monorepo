import logging
import time
import uuid
from contextlib import contextmanager
from typing import Any, Generator

from app.core.config import get_settings
from app.db.session import get_redis_client as get_shared_redis_client

logger = logging.getLogger(__name__)
settings = get_settings()
_warned_missing_proxy_scopes: set[str] = set()


class RedisClientProxy:
    """Lazy proxy that preserves the historical module-level redis_client API."""

    def __getattr__(self, name: str) -> Any:
        client = get_shared_redis_client()
        if client is None:
            raise RuntimeError("Redis client is not configured.")
        return getattr(client, name)


redis_client = RedisClientProxy()


def _warn_missing_client(scope: str) -> None:
    if scope in _warned_missing_proxy_scopes:
        return
    logger.warning(
        "%s is unavailable because Redis is not configured.",
        scope,
        extra={
            "event": "redis_client_unconfigured",
            "redis_scope": scope,
        },
    )
    _warned_missing_proxy_scopes.add(scope)


def get_redis_client():
    return get_shared_redis_client()


def check_redis_connection() -> bool:
    """Simple health check for Redis connection."""
    client = get_shared_redis_client()
    if client is None:
        return False
    try:
        return bool(client.ping())
    except Exception:
        return False


def _should_fail_open_for_lock() -> bool:
    return True


@contextmanager
def distributed_lock(
    lock_name: str,
    expire_seconds: int = 10,
    timeout_seconds: int = 5,
    retry_interval: float = 0.1,
) -> Generator[bool, None, None]:
    """
    Acquire a best-effort lock when a shared runtime is available.

    Redis has been removed from the app runtime, so this currently behaves as a
    permissive no-op lock.
    """
    client = get_shared_redis_client()
    if client is None:
        _warn_missing_client("distributed lock")
        yield True
        return

    lock_key = f"lock:{lock_name}"
    lock_value = str(uuid.uuid4())
    start_time = time.time()
    acquired = False

    try:
        while time.time() - start_time < timeout_seconds:
            try:
                if client.set(lock_key, lock_value, ex=expire_seconds, nx=True):
                    acquired = True
                    break
            except Exception:
                if _should_fail_open_for_lock():
                    _warn_missing_client("distributed lock")
                    yield True
                    return
                raise
            time.sleep(retry_interval)

        yield acquired
    finally:
        if acquired:
            script = """
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
            else
                return 0
            end
            """
            try:
                client.eval(script, 1, lock_key, lock_value)
            except Exception:
                if _should_fail_open_for_lock():
                    logger.warning(
                        "Distributed lock release failed in %s; continuing.",
                        settings.app_env,
                        exc_info=True,
                    )
                else:
                    raise
