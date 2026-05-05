"""Pydantic schemas for patient mobile-app notifications.

Field names mirror the mobile `NotificationModel` (lib/models/notification_model.dart):
the mobile app reads `user_id` rather than `patient_id`, so the response
serializer below maps the patient UUID into `user_id`.
"""

from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class PatientNotificationOut(BaseModel):
    id: UUID
    user_id: UUID
    title: str
    message: str
    category: str
    data: Optional[dict[str, Any]] = None
    is_read: bool
    created_at: datetime


class PatientNotificationListResponse(BaseModel):
    items: list[PatientNotificationOut]
    total: int


class PatientNotificationCreate(BaseModel):
    """Payload for staff-initiated push notifications.

    Used by `POST /patient-app/{patient_id}/notifications` (admin/doctor) to
    send a real-time push to a specific patient's mobile app. Also used
    internally by other services that publish notifications.
    """

    title: str = Field(min_length=1, max_length=255)
    message: str = Field(min_length=1)
    category: str = Field(default="info", pattern="^(critical|warning|info|normal)$")
    data: Optional[dict[str, Any]] = None
