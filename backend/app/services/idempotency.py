import json
import logging
from typing import Any, Optional

from fastapi import HTTPException, Request, status

from app.services.redis_runtime import (
    decode_cached_value,
    get_redis_client_or_log,
    log_redis_operation_failure,
)

logger = logging.getLogger(__name__)

IDEMPOTENCY_PREFIX = "idempotency:v1:"
PROCESSING_MARKER = "__PROCESSING__"
_REDIS_SCOPE = "idempotency cache"
_FALLBACK_LABEL = "stateless request processing"


def _get_idempotency_redis_client():
    return get_redis_client_or_log(
        logger,
        scope=_REDIS_SCOPE,
        fallback_label=_FALLBACK_LABEL,
    )

async def get_idempotency_key(request: Request) -> Optional[str]:
    """Extract idempotency key from headers."""
    return request.headers.get("Idempotency-Key")

def check_idempotency(key: str, user_id: str) -> Optional[dict]:
    """
    Check if a request with this key and user has already been completed.
    Returns the cached response data if found.
    """
    cache_key = f"{IDEMPOTENCY_PREFIX}{user_id}:{key}"
    redis_client = _get_idempotency_redis_client()
    if redis_client is None:
        return None
    try:
        value = redis_client.get(cache_key)
        if not value:
            return None

        normalized_value = decode_cached_value(value)
        if normalized_value == PROCESSING_MARKER:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Request with this idempotency key is already in progress."
            )

        if normalized_value is None:
            return None
        return json.loads(normalized_value)
    except HTTPException:
        raise
    except Exception:
        log_redis_operation_failure(
            logger,
            scope=_REDIS_SCOPE,
            operation="read",
            fallback_label=_FALLBACK_LABEL,
        )
        return None

def lock_idempotency(key: str, user_id: str, expire: int = 60) -> bool:
    """Lock the key for processing."""
    cache_key = f"{IDEMPOTENCY_PREFIX}{user_id}:{key}"
    redis_client = _get_idempotency_redis_client()
    if redis_client is None:
        return True
    try:
        return bool(redis_client.set(cache_key, PROCESSING_MARKER, nx=True, ex=expire))
    except Exception:
        log_redis_operation_failure(
            logger,
            scope=_REDIS_SCOPE,
            operation="lock",
            fallback_label=_FALLBACK_LABEL,
        )
        return True # Fallback to true to allow request to proceed if Redis is down

def save_idempotency_response(key: str, user_id: str, response_data: Any, expire: int = 86400) -> None:
    """Save the final response data in Redis."""
    cache_key = f"{IDEMPOTENCY_PREFIX}{user_id}:{key}"
    redis_client = _get_idempotency_redis_client()
    if redis_client is None:
        return
    try:
        redis_client.set(cache_key, json.dumps(response_data), ex=expire)
    except Exception:
        log_redis_operation_failure(
            logger,
            scope=_REDIS_SCOPE,
            operation="write",
            fallback_label=_FALLBACK_LABEL,
        )
