from uuid import uuid4

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base


class DoctorPatientAssignment(Base):
    __tablename__ = "doctor_patient_assignments"
    __table_args__ = (
        UniqueConstraint("doctor_id", "patient_id", name="uq_dpa_doctor_patient_pair"),
        CheckConstraint(
            "role IN ('primary', 'consulting')",
            name="ck_dpa_role_allowed",
        ),
        Index(
            "uq_dpa_primary_per_patient",
            "patient_id",
            unique=True,
            postgresql_where=text("role = 'primary'"),
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    doctor_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    patient_id = Column(UUID(as_uuid=True), ForeignKey("patients.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(50), nullable=False, default="primary")
    assigned_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    doctor = relationship("User", back_populates="patient_assignments")
    patient = relationship("Patient", back_populates="assigned_doctors")
