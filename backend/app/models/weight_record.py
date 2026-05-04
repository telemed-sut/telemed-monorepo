import uuid
from datetime import datetime

from sqlalchemy import Float, DateTime, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base

class WeightRecord(Base):
    __tablename__ = "weight_records"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patients.id", ondelete="CASCADE"),
        nullable=False,
    )
    
    weight_kg: Mapped[float] = mapped_column(Float, nullable=False)
    height_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    
    measured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    recorded_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationship to Patient
    patient = relationship("Patient", back_populates="weight_records")
    recorder = relationship("User", foreign_keys=[recorded_by])

    @property
    def bmi(self) -> float | None:
        if not self.height_cm or self.height_cm <= 0:
            return None
        height_m = self.height_cm / 100
        return round(self.weight_kg / (height_m * height_m), 1)

    __table_args__ = (
        Index("ix_weight_records_patient_id", "patient_id"),
        Index("ix_weight_records_measured_at", "measured_at"),
    )
