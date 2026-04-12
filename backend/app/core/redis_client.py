import redis
import time
import uuid
from contextlib import contextmanager
from typing import Generator
from app.core.config import get_settings

settings = get_settings()

# Use the same connection pool logic as in session.py to avoid multiple pools
# But provide a clean singleton for the application
_redis_client: redis.Redis | None = None

def get_redis_client() -> redis.Redis:
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    
    redis_url = settings.redis_url or "redis://localhost:6379"
    _redis_client = redis.from_url(
        redis_url,
        encoding="utf-8",
        decode_responses=True
    )
    return _redis_client

# Shortcut for common operations
redis_client = get_redis_client()

def check_redis_connection():
    """Simple health check for Redis connection."""
    try:
        return redis_client.ping()
    except Exception:
        return False

@contextmanager
def distributed_lock(
    lock_name: str,
    expire_seconds: int = 10,
    timeout_seconds: int = 5,
    retry_interval: float = 0.1
) -> Generator[bool, None, None]:
    """
    A simple distributed lock implementation using Redis SET NX.
    
    Args:
        lock_name: Unique name for the lock.
        expire_seconds: Time after which the lock automatically expires.
        timeout_seconds: How long to wait to acquire the lock before giving up.
        retry_interval: Interval between retry attempts.
    """
    client = get_redis_client()
    lock_key = f"lock:{lock_name}"
    lock_value = str(uuid.uuid4())
    start_time = time.time()
    acquired = False

    try:
        while time.time() - start_time < timeout_seconds:
            if client.set(lock_key, lock_value, ex=expire_seconds, nx=True):
                acquired = True
                break
            time.sleep(retry_interval)
        
        yield acquired
    finally:
        if acquired:
            # Only delete if we are the owner (value matches)
            # Use Lua script for atomic check-and-delete
            script = """
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
            else
                return 0
            end
            """
            client.eval(script, 1, lock_key, lock_value)
