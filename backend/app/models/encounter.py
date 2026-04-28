from uuid import uuid4

from sqlalchemy import Column, DateTime, Enum, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base
from app.models.enums import EncounterStatus, EncounterType


class Encounter(Base):
    __tablename__ = "encounters"
    __table_args__ = (
        Index("ix_encounters_status", "status"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    patient_id = Column(UUID(as_uuid=True), ForeignKey("patients.id", ondelete="CASCADE"), nullable=False, index=True)
    encounter_type = Column(Enum(EncounterType, name="encounter_type", create_type=False), nullable=False)
    status = Column(Enum(EncounterStatus, name="encounter_status", create_type=False), nullable=False, default=EncounterStatus.active)
    admitted_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    discharged_at = Column(DateTime(timezone=True), nullable=True)
    ward = Column(String(100), nullable=True)
    bed_number = Column(String(20), nullable=True)
    attending_doctor_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    chief_complaint = Column(Text, nullable=True)
    discharge_summary = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    patient = relationship("Patient", back_populates="encounters")
    attending_doctor = relationship("User", foreign_keys=[attending_doctor_id])
