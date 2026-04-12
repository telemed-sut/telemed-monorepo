import json
import logging
from typing import Optional, Any
from fastapi import Request, Response, HTTPException, status
from app.core.redis_client import redis_client

logger = logging.getLogger(__name__)

IDEMPOTENCY_PREFIX = "idempotency:v1:"
PROCESSING_MARKER = "__PROCESSING__"

async def get_idempotency_key(request: Request) -> Optional[str]:
    """Extract idempotency key from headers."""
    return request.headers.get("Idempotency-Key")

def check_idempotency(key: str, user_id: str) -> Optional[dict]:
    """
    Check if a request with this key and user has already been completed.
    Returns the cached response data if found.
    """
    cache_key = f"{IDEMPOTENCY_PREFIX}{user_id}:{key}"
    try:
        value = redis_client.get(cache_key)
        if not value:
            return None
        
        if value == PROCESSING_MARKER:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Request with this idempotency key is already in progress."
            )
        
        return json.loads(value)
    except HTTPException:
        raise
    except Exception:
        logger.warning("Failed to check idempotency in Redis", exc_info=True)
        return None

def lock_idempotency(key: str, user_id: str, expire: int = 60) -> bool:
    """Lock the key for processing."""
    cache_key = f"{IDEMPOTENCY_PREFIX}{user_id}:{key}"
    try:
        return bool(redis_client.set(cache_key, PROCESSING_MARKER, nx=True, ex=expire))
    except Exception:
        logger.warning("Failed to lock idempotency in Redis", exc_info=True)
        return True # Fallback to true to allow request to proceed if Redis is down

def save_idempotency_response(key: str, user_id: str, response_data: Any, expire: int = 86400) -> None:
    """Save the final response data in Redis."""
    cache_key = f"{IDEMPOTENCY_PREFIX}{user_id}:{key}"
    try:
        redis_client.set(cache_key, json.dumps(response_data), ex=expire)
    except Exception:
        logger.warning("Failed to save idempotency response in Redis", exc_info=True)
