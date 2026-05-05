"""Patient mobile-app notifications.

Distinct from the clinical `Alert` table (which is care-team-facing). These rows
are what the patient sees in the bell/notification tab of the mobile app.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base


class PatientNotificationCategory(str, enum.Enum):
    critical = "critical"
    warning = "warning"
    info = "info"
    normal = "normal"


class PatientNotification(Base):
    __tablename__ = "patient_notifications"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patients.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[PatientNotificationCategory] = mapped_column(
        Enum(
            PatientNotificationCategory,
            name="patient_notification_category",
            create_constraint=True,
        ),
        nullable=False,
        server_default=PatientNotificationCategory.info.value,
    )
    data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    is_read: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", default=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    patient = relationship("Patient")

    __table_args__ = (
        Index("ix_patient_notifications_patient_id", "patient_id"),
        Index("ix_patient_notifications_created_at", "created_at"),
        Index(
            "ix_patient_notifications_patient_unread",
            "patient_id",
            "is_read",
        ),
    )
