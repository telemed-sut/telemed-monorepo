import uuid
from datetime import datetime

from sqlalchemy import Float, Integer, DateTime, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base

class PatientVitalThreshold(Base):
    __tablename__ = "patient_vital_thresholds"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patients.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True
    )
    
    # Heart Rate Thresholds
    min_heart_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_heart_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    
    # Blood Pressure Thresholds
    min_sys_pressure: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_sys_pressure: Mapped[int | None] = mapped_column(Integer, nullable=True)
    min_dia_pressure: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_dia_pressure: Mapped[int | None] = mapped_column(Integer, nullable=True)
    
    # Weight Thresholds
    min_weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    patient = relationship("Patient", back_populates="vital_thresholds")
    updater = relationship("User", foreign_keys=[updated_by])
