from uuid import uuid4

from sqlalchemy import Column, Date, DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base


class Patient(Base):
    __tablename__ = "patients"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    first_name = Column(String(100), nullable=False, index=True)
    last_name = Column(String(100), nullable=False, index=True)
    name = Column(String(200), nullable=True)
    people_id = Column(String(20), nullable=True, unique=True, index=True)
    age = Column(Integer, nullable=True)
    status = Column(String(50), nullable=True, default="active")
    doctor = Column(String(200), nullable=True)
    date_of_birth = Column(Date, nullable=False)
    gender = Column(String(20), nullable=True)
    phone = Column(String(50), nullable=True, index=True)
    email = Column(String(255), nullable=True, index=True)
    address = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Dense mode clinical columns
    allergies = Column(Text, nullable=True)
    blood_group = Column(String(10), nullable=True)
    risk_score = Column(Integer, nullable=True, default=0)
    primary_diagnosis = Column(String(500), nullable=True)
    ward = Column(String(100), nullable=True)
    bed_number = Column(String(20), nullable=True)

    # Relationships
    meetings = relationship("Meeting", back_populates="patient", foreign_keys="Meeting.user_id")
    assigned_doctors = relationship(
        "DoctorPatientAssignment",
        back_populates="patient",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    encounters = relationship("Encounter", back_populates="patient", order_by="Encounter.admitted_at.desc()")
    timeline_events = relationship("TimelineEvent", back_populates="patient", order_by="TimelineEvent.event_time.desc()")
    alerts = relationship("Alert", back_populates="patient")
    medications = relationship("Medication", back_populates="patient")
    labs = relationship("Lab", back_populates="patient")
    medical_histories = relationship("MedicalHistory", back_populates="patient")
    current_conditions = relationship("CurrentCondition", back_populates="patient")
    treatments = relationship("Treatment", back_populates="patient")
    pressure_records = relationship("PressureRecord", back_populates="patient", order_by="PressureRecord.measured_at.desc()")
