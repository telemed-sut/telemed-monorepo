from datetime import datetime
import uuid

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base


class HeartSoundRecord(Base):
    __tablename__ = "heart_sound_records"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False)
    device_id: Mapped[str] = mapped_column(String(128), nullable=False)
    mac_address: Mapped[str] = mapped_column(String(64), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    blob_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    storage_key: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    patient = relationship("Patient", back_populates="heart_sound_records")

    __table_args__ = (
        Index("ix_heart_sound_records_patient_id", "patient_id"),
        Index("ix_heart_sound_records_device_id", "device_id"),
        Index("ix_heart_sound_records_mac_address", "mac_address"),
        Index("ix_heart_sound_records_position", "position"),
        Index("ix_heart_sound_records_recorded_at", "recorded_at"),
    )
