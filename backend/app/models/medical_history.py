from uuid import uuid4

from sqlalchemy import Column, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base


class MedicalHistory(Base):
    __tablename__ = "medical_history"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    patient_id = Column(UUID(as_uuid=True), ForeignKey("patients.id", ondelete="CASCADE"), nullable=False, index=True)
    condition = Column(String(500), nullable=False)
    diagnosed_date = Column(DateTime(timezone=True), nullable=True)
    resolved_date = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)
    recorded_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    patient = relationship("Patient", back_populates="medical_histories")
