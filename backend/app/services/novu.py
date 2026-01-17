"""
Novu notification service for sending in-app notifications
"""
import logging
from typing import Optional, Dict, Any, List

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# Demo subscriber ID from Novu onboarding
# TODO: For production, sync users with Novu using their actual user IDs
DEMO_SUBSCRIBER_ID = "69672b3590916202e24e18f7"

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
        logger.info(f"Notification sent to {subscriber_id}: {workflow_name}")
        return True
    except Exception as e:
        logger.error(f"Failed to send notification: {e}")
        return False


def notify_patient_created(
    subscriber_ids: List[str],
    patient_name: str,
    created_by: str
) -> None:
    """Notify when a new patient is created"""
    # For demo, send to demo subscriber
    send_notification(
        subscriber_id=DEMO_SUBSCRIBER_ID,
        workflow_name="onboarding-demo-workflow",
        payload={
            "message": f"New patient '{patient_name}' was created by {created_by}"
        }
    )


def notify_patient_updated(
    subscriber_ids: List[str],
    patient_name: str,
    updated_by: str
) -> None:
    """Notify when a patient is updated"""
    send_notification(
        subscriber_id=DEMO_SUBSCRIBER_ID,
        workflow_name="onboarding-demo-workflow",
        payload={
            "message": f"Patient '{patient_name}' was updated by {updated_by}"
        }
    )


def notify_patient_deleted(
    subscriber_ids: List[str],
    patient_name: str,
    deleted_by: str
) -> None:
    """Notify when a patient is deleted"""
    send_notification(
        subscriber_id=DEMO_SUBSCRIBER_ID,
        workflow_name="onboarding-demo-workflow",
        payload={
            "message": f"Patient '{patient_name}' was deleted by {deleted_by}"
        }
    )
