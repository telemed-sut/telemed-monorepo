"""
Novu notification service for sending in-app notifications
"""
import logging
from typing import Optional, Dict, Any, List

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# Lazy initialization
_novu_client = None


def get_novu_client():
    """Get or create Novu client instance"""
    global _novu_client
    settings = get_settings()
    
    if not settings.novu_enabled or not settings.novu_api_key:
        return None
    
    if _novu_client is None:
        try:
            from novu.api import EventApi
            _novu_client = EventApi(
                url="https://api.novu.co",
                api_key=settings.novu_api_key
            )
            logger.info("Novu client initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize Novu client: {e}")
            return None
    
    return _novu_client


def send_notification(
    subscriber_id: str,
    workflow_name: str,
    payload: Optional[Dict[str, Any]] = None
) -> bool:
    """
    Send a notification to a subscriber
    """
    client = get_novu_client()
    
    if client is None:
        logger.debug("Novu is not enabled, skipping notification")
        return False
    
    try:
        from novu.dto.event import InputEventDto

        event = InputEventDto(
            name=workflow_name,
            recipients=subscriber_id,
            payload=payload or {}
        )
        client.trigger(event)
        logger.info("Notification sent: workflow=%s", workflow_name)
        return True
    except Exception as e:
        logger.error("Failed to send notification: %s", e)
        return False


def notify_patient_created(
    subscriber_ids: List[str],
    patient_id: str,
    created_by_user_id: str
) -> None:
    """Notify when a new patient is created without sending PHI/PII."""
    payload = {
        "event": "patient_created",
        "patient_id": patient_id,
        "actor_user_id": created_by_user_id,
    }
    for subscriber_id in subscriber_ids:
        send_notification(
            subscriber_id=subscriber_id,
            workflow_name="patient-events",
            payload=payload,
        )


def notify_patient_updated(
    subscriber_ids: List[str],
    patient_id: str,
    updated_by_user_id: str
) -> None:
    """Notify when a patient is updated without sending PHI/PII."""
    payload = {
        "event": "patient_updated",
        "patient_id": patient_id,
        "actor_user_id": updated_by_user_id,
    }
    for subscriber_id in subscriber_ids:
        send_notification(
            subscriber_id=subscriber_id,
            workflow_name="patient-events",
            payload=payload,
        )


def notify_patient_deleted(
    subscriber_ids: List[str],
    patient_id: str,
    deleted_by_user_id: str
) -> None:
    """Notify when a patient is deleted without sending PHI/PII."""
    payload = {
        "event": "patient_deleted",
        "patient_id": patient_id,
        "actor_user_id": deleted_by_user_id,
    }
    for subscriber_id in subscriber_ids:
        send_notification(
            subscriber_id=subscriber_id,
            workflow_name="patient-events",
            payload=payload,
        )
