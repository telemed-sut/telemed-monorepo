from uuid import uuid4

from sqlalchemy import Column, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base


class DoctorPatientAssignment(Base):
    __tablename__ = "doctor_patient_assignments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    doctor_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    patient_id = Column(UUID(as_uuid=True), ForeignKey("patients.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(50), nullable=True, default="primary")
    assigned_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    doctor = relationship("User", back_populates="patient_assignments")
    patient = relationship("Patient", back_populates="assigned_doctors")
