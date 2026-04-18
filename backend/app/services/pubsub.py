import json
import logging
from typing import Any

from app.services.redis_runtime import get_redis_client_or_log, log_redis_operation_failure

logger = logging.getLogger(__name__)
_REDIS_SCOPE = "realtime pubsub"
_FALLBACK_LABEL = "best-effort no-op publish"

def publish_realtime_event(channel: str, event_type: str, data: Any) -> bool:
    """
    Publish a JSON event to a Redis channel for real-time subscribers (WebSockets).
    
    Args:
        channel: The Redis channel to publish to (e.g. 'patient:UUID:events')
        event_type: The name of the event (e.g. 'new_pressure_reading')
        data: The payload data (must be JSON serializable)
    """
    payload = {
        "event": event_type,
        "data": data,
        "published_at": None # We could add timestamp here
    }

    redis_client = get_redis_client_or_log(
        logger,
        scope=_REDIS_SCOPE,
        fallback_label=_FALLBACK_LABEL,
    )
    if redis_client is None:
        return False

    try:
        # Using the standard redis-py publish method
        redis_client.publish(channel, json.dumps(payload))
        return True
    except Exception:
        log_redis_operation_failure(
            logger,
            scope=_REDIS_SCOPE,
            operation="publish",
            fallback_label=_FALLBACK_LABEL,
        )
        return False

def get_patient_channel(patient_id: str) -> str:
    """Standard channel naming convention for patient-related events."""
    return f"patient:{patient_id}:events"
