import logging
from typing import Any

logger = logging.getLogger(__name__)

def publish_realtime_event(channel: str, event_type: str, data: Any) -> bool:
    """
    Legacy realtime publish hook.

    Patient workspace updates are now delivered by DB-backed SSE endpoints, so
    this best-effort hook intentionally does not use an external broker.
    """
    logger.debug(
        "Realtime publish skipped; DB-backed SSE is the active delivery path.",
        extra={"channel": channel, "event_type": event_type},
    )
    return False

def get_patient_channel(patient_id: str) -> str:
    """Standard channel naming convention for patient-related events."""
    return f"patient:{patient_id}:events"
