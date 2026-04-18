import logging
import time
from typing import List

from app.services.redis_runtime import get_redis_client_or_log, log_redis_operation_failure

logger = logging.getLogger(__name__)

PRESENCE_SET_KEY = "presence:online_users:v1"
PRESENCE_TIMEOUT_SECONDS = 60
_REDIS_SCOPE = "global presence index"
_FALLBACK_LABEL = "empty presence state"


def _get_presence_redis_client():
    return get_redis_client_or_log(
        logger,
        scope=_REDIS_SCOPE,
        fallback_label=_FALLBACK_LABEL,
    )

def touch_global_presence(user_id: str) -> None:
    """Update a user's online status in the global presence index."""
    redis_client = _get_presence_redis_client()
    if redis_client is None:
        return
    try:
        now = int(time.time())
        # Use a Sorted Set where score is the timestamp
        redis_client.zadd(PRESENCE_SET_KEY, {user_id: now})
        
        # Periodic cleanup of old entries (can be done here or in a separate task)
        # We do it here occasionally (e.g. 1 in 10 heartbeats) to keep the set bounded
        if now % 10 == 0:
            cleanup_expired_presence()
    except Exception:
        log_redis_operation_failure(
            logger,
            scope=_REDIS_SCOPE,
            operation="touch",
            fallback_label=_FALLBACK_LABEL,
        )

def cleanup_expired_presence() -> int:
    """Remove users who haven't sent a heartbeat within the timeout window."""
    redis_client = _get_presence_redis_client()
    if redis_client is None:
        return 0
    try:
        timeout_threshold = int(time.time()) - PRESENCE_TIMEOUT_SECONDS
        return redis_client.zremrangebyscore(PRESENCE_SET_KEY, "-inf", timeout_threshold)
    except Exception:
        log_redis_operation_failure(
            logger,
            scope=_REDIS_SCOPE,
            operation="cleanup",
            fallback_label=_FALLBACK_LABEL,
        )
        return 0

def get_online_user_ids() -> List[str]:
    """Get a list of currently active user IDs."""
    redis_client = _get_presence_redis_client()
    if redis_client is None:
        return []
    try:
        now = int(time.time())
        timeout_threshold = now - PRESENCE_TIMEOUT_SECONDS
        return redis_client.zrangebyscore(PRESENCE_SET_KEY, timeout_threshold, "+inf")
    except Exception:
        log_redis_operation_failure(
            logger,
            scope=_REDIS_SCOPE,
            operation="read",
            fallback_label=_FALLBACK_LABEL,
        )
        return []

def is_user_online(user_id: str) -> bool:
    """Check if a specific user is currently considered online."""
    redis_client = _get_presence_redis_client()
    if redis_client is None:
        return False
    try:
        score = redis_client.zscore(PRESENCE_SET_KEY, user_id)
        if score is None:
            return False
        
        timeout_threshold = int(time.time()) - PRESENCE_TIMEOUT_SECONDS
        return score >= timeout_threshold
    except Exception:
        log_redis_operation_failure(
            logger,
            scope=_REDIS_SCOPE,
            operation="check",
            fallback_label=_FALLBACK_LABEL,
        )
        return False
