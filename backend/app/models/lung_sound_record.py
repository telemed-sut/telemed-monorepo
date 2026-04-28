from datetime import datetime
import uuid

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Index, Integer, JSON, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base
from app.models.enums import DeviceMeasurementRoutingStatus


class LungSoundRecord(Base):
    __tablename__ = "lung_sound_records"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patients.id", ondelete="CASCADE"),
        nullable=True,
    )
    device_exam_session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("device_exam_sessions.id", ondelete="SET NULL"),
        nullable=True,
    )
    device_id: Mapped[str] = mapped_column(String(128), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    blob_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    storage_key: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sample_rate_hz: Mapped[int | None] = mapped_column(Integer, nullable=True)
    channel_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    wheeze_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    crackle_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    analysis: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    routing_status: Mapped[DeviceMeasurementRoutingStatus] = mapped_column(
        Enum(
            DeviceMeasurementRoutingStatus,
            name="device_measurement_routing_status",
            create_type=False,
        ),
        nullable=False,
        default=DeviceMeasurementRoutingStatus.verified,
        server_default=DeviceMeasurementRoutingStatus.verified.value,
    )
    conflict_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    server_received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    patient = relationship("Patient", back_populates="lung_sound_records")
    device_exam_session = relationship("DeviceExamSession")

    __table_args__ = (
        Index("ix_lung_sound_records_patient_id", "patient_id"),
        Index("ix_lung_sound_records_device_exam_session_id", "device_exam_session_id"),
        Index("ix_lung_sound_records_device_id", "device_id"),
        Index("ix_lung_sound_records_position", "position"),
        Index("ix_lung_sound_records_recorded_at", "recorded_at"),
        Index("ix_lung_sound_records_blob_url", "blob_url"),
        Index("ix_lung_sound_records_session_routing", "device_exam_session_id", "routing_status"),
        Index("ix_lung_sound_records_device_received_at", "device_id", "server_received_at"),
        CheckConstraint(
            "((routing_status = 'verified' AND device_exam_session_id IS NOT NULL) "
            "OR (routing_status = 'unmatched' AND device_exam_session_id IS NULL) "
            "OR routing_status IN ('needs_review', 'quarantined'))",
            name="ck_lung_sound_records_routing_consistency",
        ),
        UniqueConstraint("device_id", "recorded_at", "position", name="uq_lung_sound_records_device_recorded_position"),
    )
