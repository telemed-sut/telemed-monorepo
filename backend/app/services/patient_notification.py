"""Service layer for patient mobile-app notifications.

Public functions:
    list_for_patient(...)        — paginated read for /patient-app/me/notifications
    mark_read(...)               — mark a single notification as read
    mark_all_read(...)           — bulk mark
    delete(...)                  — hard delete one notification
    create_for_patient(...)      — used by other services to push a notification;
                                   also fan-out via Redis pub/sub for SSE listeners
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, delete, func, select, update
from sqlalchemy.orm import Session

from app.models.patient_notification import (
    PatientNotification,
    PatientNotificationCategory,
)

logger = logging.getLogger(__name__)

_PATIENT_STREAM_CHANNEL_PREFIX = "telemed:patient_app:"
_DEFAULT_LIST_LIMIT = 100


def patient_stream_channel(patient_id: UUID | str) -> str:
    return f"{_PATIENT_STREAM_CHANNEL_PREFIX}{patient_id}"


def _serialize(notification: PatientNotification) -> dict[str, Any]:
    category = notification.category
    category_value = category.value if hasattr(category, "value") else str(category)
    return {
        "id": str(notification.id),
        "user_id": str(notification.patient_id),
        "title": notification.title,
        "message": notification.message,
        "category": category_value,
        "data": notification.data,
        "is_read": bool(notification.is_read),
        "created_at": notification.created_at.isoformat()
        if notification.created_at
        else None,
    }


def list_for_patient(
    *,
    db: Session,
    patient_id: UUID,
    limit: int = _DEFAULT_LIST_LIMIT,
    offset: int = 0,
) -> dict[str, Any]:
    safe_limit = max(1, min(int(limit or _DEFAULT_LIST_LIMIT), 200))
    safe_offset = max(0, int(offset or 0))

    items_stmt = (
        select(PatientNotification)
        .where(PatientNotification.patient_id == patient_id)
        .order_by(PatientNotification.created_at.desc())
        .limit(safe_limit)
        .offset(safe_offset)
    )
    items = db.scalars(items_stmt).all()
    total = (
        db.scalar(
            select(func.count(PatientNotification.id)).where(
                PatientNotification.patient_id == patient_id
            )
        )
        or 0
    )
    return {
        "items": [_serialize(item) for item in items],
        "total": int(total),
    }


def mark_read(
    *,
    db: Session,
    patient_id: UUID,
    notification_id: UUID,
) -> None:
    notification = db.scalar(
        select(PatientNotification).where(
            and_(
                PatientNotification.id == notification_id,
                PatientNotification.patient_id == patient_id,
            )
        )
    )
    if notification is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found.",
        )
    if not notification.is_read:
        notification.is_read = True
        db.add(notification)
        db.commit()


def mark_all_read(*, db: Session, patient_id: UUID) -> int:
    result = db.execute(
        update(PatientNotification)
        .where(
            and_(
                PatientNotification.patient_id == patient_id,
                PatientNotification.is_read.is_(False),
            )
        )
        .values(is_read=True)
    )
    db.commit()
    return int(result.rowcount or 0)


def delete_for_patient(
    *,
    db: Session,
    patient_id: UUID,
    notification_id: UUID,
) -> None:
    result = db.execute(
        delete(PatientNotification).where(
            and_(
                PatientNotification.id == notification_id,
                PatientNotification.patient_id == patient_id,
            )
        )
    )
    if (result.rowcount or 0) == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found.",
        )
    db.commit()


def _publish_notification_event(
    *,
    patient_id: UUID,
    payload: dict[str, Any],
) -> None:
    """Fan out the new notification through Redis pub/sub so any SSE listener
    for this patient receives an `event: notification` immediately.

    Failures are logged and swallowed — the DB row is the source of truth and
    polling fallback in the mobile app will still pick it up.
    """
    try:
        from app.services.redis import redis_manager  # local import to avoid cycles

        channel = patient_stream_channel(patient_id)
        message = json.dumps({"event": "notification", "data": payload})
        redis_manager.client.publish(channel, message)
    except Exception:
        logger.warning(
            "Failed to publish patient notification to Redis",
            extra={"patient_id": str(patient_id)},
            exc_info=True,
        )


def create_for_patient(
    *,
    db: Session,
    patient_id: UUID,
    title: str,
    message: str,
    category: str = "info",
    data: dict[str, Any] | None = None,
    publish: bool = True,
) -> PatientNotification:
    """Insert a notification row and (optionally) fan it out via Redis pub/sub."""
    try:
        category_enum = PatientNotificationCategory(category)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Invalid notification category. Must be one of "
                "critical, warning, info, normal."
            ),
        ) from exc

    notification = PatientNotification(
        patient_id=patient_id,
        title=title,
        message=message,
        category=category_enum,
        data=data,
        created_at=datetime.now(timezone.utc),
    )
    db.add(notification)
    db.commit()
    db.refresh(notification)

    if publish:
        _publish_notification_event(
            patient_id=patient_id,
            payload=_serialize(notification),
        )

    return notification
