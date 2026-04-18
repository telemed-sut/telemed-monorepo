import logging
from typing import Optional

from app.db.session import get_redis_client

logger = logging.getLogger(__name__)

DEVICE_SECRET_CACHE_PREFIX = "device_secret:v1:"
DEVICE_SECRET_TTL = 3600  # 1 hour
_DASHBOARD_STATS_NAMESPACE_KEY = "stats:overview:v3:namespace"
_DASHBOARD_STATS_NAMESPACE_DEFAULT = "1"


def _get_dashboard_stats_namespace() -> str:
    redis_client = get_redis_client()
    if redis_client is None:
        return _DASHBOARD_STATS_NAMESPACE_DEFAULT

    try:
        namespace = redis_client.get(_DASHBOARD_STATS_NAMESPACE_KEY)
    except Exception:
        logger.warning("Failed to read dashboard stats cache namespace", exc_info=True)
        return _DASHBOARD_STATS_NAMESPACE_DEFAULT

    if isinstance(namespace, bytes):
        namespace = namespace.decode("utf-8")
    if isinstance(namespace, str) and namespace.strip():
        return namespace.strip()
    return _DASHBOARD_STATS_NAMESPACE_DEFAULT


def get_dashboard_stats_cache_key(*, role: str, user_id: str, year: int) -> str:
    namespace = _get_dashboard_stats_namespace()
    return f"stats:overview:v3:{namespace}:{role}:{user_id}:{year}"

def get_cached_device_secret(device_id: str) -> Optional[str]:
    """Retrieve device secret from Redis cache."""
    redis_client = get_redis_client()
    if redis_client is None:
        return None
    try:
        cache_key = f"{DEVICE_SECRET_CACHE_PREFIX}{device_id}"
        return redis_client.get(cache_key)
    except Exception:
        logger.warning("Failed to get cached device secret for %s", device_id, exc_info=True)
        return None

def set_cached_device_secret(device_id: str, secret: str, ttl: int = DEVICE_SECRET_TTL) -> None:
    """Store device secret in Redis cache."""
    redis_client = get_redis_client()
    if redis_client is None:
        return
    try:
        cache_key = f"{DEVICE_SECRET_CACHE_PREFIX}{device_id}"
        redis_client.set(cache_key, secret, ex=ttl)
    except Exception:
        logger.warning("Failed to cache device secret for %s", device_id, exc_info=True)

def clear_cached_device_secret(device_id: str) -> None:
    """Remove device secret from Redis cache."""
    redis_client = get_redis_client()
    if redis_client is None:
        return
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
    redis_client = get_redis_client()
    if redis_client is None:
        return
    try:
        next_namespace = redis_client.incr(_DASHBOARD_STATS_NAMESPACE_KEY)
        logger.info(
            "Bumped dashboard stats cache namespace to %s",
            next_namespace,
            extra={
                "event": "dashboard_stats_cache_namespace_bumped",
                "namespace": str(next_namespace),
            },
        )
    except Exception:
        logger.warning("Failed to invalidate dashboard stats cache", exc_info=True)
