from datetime import datetime
from typing import List

from sqlalchemy import Integer, String, DateTime, ForeignKey, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
import uuid

from app.db.base import Base

class PressureRecord(Base):
    __tablename__ = "pressure_records"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False)
    device_id: Mapped[str] = mapped_column(String, nullable=False)
    
    heart_rate: Mapped[int] = mapped_column(Integer, nullable=False)
    sys_rate: Mapped[int] = mapped_column(Integer, nullable=False)
    dia_rate: Mapped[int] = mapped_column(Integer, nullable=False)
    
    wave_a: Mapped[List[int]] = mapped_column(ARRAY(Integer), nullable=True)
    wave_b: Mapped[List[int]] = mapped_column(ARRAY(Integer), nullable=True)
    
    measured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationship to Patient
    patient = relationship("Patient", back_populates="pressure_records")

    __table_args__ = (
        Index("ix_pressure_records_patient_id", "patient_id"),
        Index("ix_pressure_records_device_id", "device_id"),
        Index("ix_pressure_records_measured_at", "measured_at"),
        Index("ix_pressure_records_created_at", "created_at"),
        UniqueConstraint("device_id", "measured_at", name="uq_pressure_records_device_measured_at"),
    )
