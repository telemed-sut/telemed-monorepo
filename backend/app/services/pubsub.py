import json
import logging
from typing import Any
from app.core.redis_client import redis_client

logger = logging.getLogger(__name__)

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
    
    try:
        # Using the standard redis-py publish method
        redis_client.publish(channel, json.dumps(payload))
        return True
    except Exception:
        logger.warning("Failed to publish real-time event to %s", channel, exc_info=True)
        return False

def get_patient_channel(patient_id: str) -> str:
    """Standard channel naming convention for patient-related events."""
    return f"patient:{patient_id}:events"
