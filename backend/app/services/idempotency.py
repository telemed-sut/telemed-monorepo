from typing import Any, Optional

from fastapi import Request

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
    return None

def lock_idempotency(key: str, user_id: str, expire: int = 60) -> bool:
    """Lock the key for processing."""
    return True

def save_idempotency_response(key: str, user_id: str, response_data: Any, expire: int = 86400) -> None:
    """Keep the historical hook without a shared cache backend."""
    return None
