import logging
from typing import Optional
from app.core.redis_client import redis_client

logger = logging.getLogger(__name__)

DEVICE_SECRET_CACHE_PREFIX = "device_secret:v1:"
DEVICE_SECRET_TTL = 3600  # 1 hour

def get_cached_device_secret(device_id: str) -> Optional[str]:
    """Retrieve device secret from Redis cache."""
    try:
        cache_key = f"{DEVICE_SECRET_CACHE_PREFIX}{device_id}"
        return redis_client.get(cache_key)
    except Exception:
        logger.warning("Failed to get cached device secret for %s", device_id, exc_info=True)
        return None

def set_cached_device_secret(device_id: str, secret: str, ttl: int = DEVICE_SECRET_TTL) -> None:
    """Store device secret in Redis cache."""
    try:
        cache_key = f"{DEVICE_SECRET_CACHE_PREFIX}{device_id}"
        redis_client.set(cache_key, secret, ex=ttl)
    except Exception:
        logger.warning("Failed to cache device secret for %s", device_id, exc_info=True)

def clear_cached_device_secret(device_id: str) -> None:
    """Remove device secret from Redis cache."""
    try:
        cache_key = f"{DEVICE_SECRET_CACHE_PREFIX}{device_id}"
        redis_client.delete(cache_key)
    except Exception:
        logger.warning("Failed to clear cached device secret for %s", device_id, exc_info=True)

def clear_dashboard_stats_cache() -> None:
    """
    Invalidate all dashboard overview stats.
    Called when data that affects global or per-user stats changes.
    """
    try:
        # We use a pattern-based delete for the overview stats
        # Note: In a very large system, KEYS/SCAN might be slow, but for dashboard
        # stats with 5-minute TTL, the number of keys is manageable.
        pattern = "stats:overview:v2:*"
        keys = redis_client.keys(pattern)
        if keys:
            redis_client.delete(*keys)
            logger.info("Invalidated %d dashboard stats cache keys", len(keys))
    except Exception:
        logger.warning("Failed to invalidate dashboard stats cache", exc_info=True)
