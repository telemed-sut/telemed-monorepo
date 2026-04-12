import logging
import time
from typing import List, Set
from app.core.redis_client import redis_client

logger = logging.getLogger(__name__)

PRESENCE_SET_KEY = "presence:online_users:v1"
PRESENCE_TIMEOUT_SECONDS = 60

def touch_global_presence(user_id: str) -> None:
    """Update a user's online status in the global presence index."""
    try:
        now = int(time.time())
        # Use a Sorted Set where score is the timestamp
        redis_client.zadd(PRESENCE_SET_KEY, {user_id: now})
        
        # Periodic cleanup of old entries (can be done here or in a separate task)
        # We do it here occasionally (e.g. 1 in 10 heartbeats) to keep the set bounded
        if now % 10 == 0:
            cleanup_expired_presence()
    except Exception:
        logger.warning("Failed to update global presence in Redis", exc_info=True)

def cleanup_expired_presence() -> int:
    """Remove users who haven't sent a heartbeat within the timeout window."""
    try:
        timeout_threshold = int(time.time()) - PRESENCE_TIMEOUT_SECONDS
        return redis_client.zremrangebyscore(PRESENCE_SET_KEY, "-inf", timeout_threshold)
    except Exception:
        logger.warning("Failed to cleanup expired presence in Redis", exc_info=True)
        return 0

def get_online_user_ids() -> List[str]:
    """Get a list of currently active user IDs."""
    try:
        now = int(time.time())
        timeout_threshold = now - PRESENCE_TIMEOUT_SECONDS
        return redis_client.zrangebyscore(PRESENCE_SET_KEY, timeout_threshold, "+inf")
    except Exception:
        logger.warning("Failed to get online users from Redis", exc_info=True)
        return []

def is_user_online(user_id: str) -> bool:
    """Check if a specific user is currently considered online."""
    try:
        score = redis_client.zscore(PRESENCE_SET_KEY, user_id)
        if score is None:
            return False
        
        timeout_threshold = int(time.time()) - PRESENCE_TIMEOUT_SECONDS
        return score >= timeout_threshold
    except Exception:
        logger.warning("Failed to check user presence in Redis", exc_info=True)
        return False
