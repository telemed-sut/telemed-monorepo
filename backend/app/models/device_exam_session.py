from uuid import uuid4

from sqlalchemy import CheckConstraint, Column, DateTime, Enum, ForeignKey, Index, String, Text, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base
from app.models.enums import (
    DeviceExamMeasurementType,
    DeviceExamSessionResolutionReason,
    DeviceExamSessionStatus,
)


class DeviceExamSession(Base):
    __tablename__ = "device_exam_sessions"
    __table_args__ = (
        Index("ix_device_exam_sessions_device_status_started", "device_id", "status", "started_at"),
        Index("ix_device_exam_sessions_patient_status_created", "patient_id", "status", "created_at"),
        Index("ix_device_exam_sessions_pairing_code", "pairing_code"),
        Index(
            "uq_device_exam_sessions_device_open",
            "device_id",
            unique=True,
            postgresql_where=text("status IN ('pending_pair', 'active', 'stale')"),
            sqlite_where=text("status IN ('pending_pair', 'active', 'stale')"),
        ),
        CheckConstraint(
            "((status IN ('completed', 'cancelled', 'review_needed') AND ended_at IS NOT NULL) "
            "OR (status IN ('pending_pair', 'active', 'stale') AND ended_at IS NULL))",
            name="ck_device_exam_sessions_status_ended_at",
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    patient_id = Column(UUID(as_uuid=True), ForeignKey("patients.id", ondelete="CASCADE"), nullable=False, index=True)
    encounter_id = Column(UUID(as_uuid=True), ForeignKey("encounters.id", ondelete="SET NULL"), nullable=True, index=True)
    started_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    ended_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    device_id = Column(String(128), nullable=False, index=True)
    measurement_type = Column(
        Enum(DeviceExamMeasurementType, name="device_exam_measurement_type", create_type=False),
        nullable=False,
    )
    status = Column(
        Enum(DeviceExamSessionStatus, name="device_exam_session_status", create_type=False),
        nullable=False,
        default=DeviceExamSessionStatus.active,
        server_default=DeviceExamSessionStatus.active.value,
    )
    resolution_reason = Column(
        Enum(
            DeviceExamSessionResolutionReason,
            name="device_exam_session_resolution_reason",
            create_type=False,
        ),
        nullable=True,
    )
    pairing_code = Column(String(32), nullable=True)
    notes = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    last_seen_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    patient = relationship("Patient", back_populates="device_exam_sessions")
    encounter = relationship("Encounter")
    starter = relationship("User", foreign_keys=[started_by])
    ender = relationship("User", foreign_keys=[ended_by])
