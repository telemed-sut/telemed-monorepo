import enum
from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, Enum, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base
from app.models.enums import UserRole, VerificationStatus


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    first_name = Column(String(100), nullable=True)
    last_name = Column(String(100), nullable=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(
        Enum(UserRole, name="user_role", create_type=False),
        nullable=False,
        default=UserRole.staff,
    )
    is_active = Column(Boolean, nullable=False, server_default="true", default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)

    # Dense mode columns
    specialty = Column(String(200), nullable=True)
    department = Column(String(200), nullable=True)

    # Professional verification fields
    license_no = Column(String(100), nullable=True)
    license_expiry = Column(DateTime(timezone=True), nullable=True)
    verification_status = Column(
        Enum(VerificationStatus, name="verification_status", create_type=False),
        nullable=False,
        server_default="unverified",
    )

    # Relationships
    meetings_as_doctor = relationship("Meeting", back_populates="doctor", foreign_keys="Meeting.doctor_id")
    patient_assignments = relationship("DoctorPatientAssignment", back_populates="doctor")

    # Security: brute force protection
    failed_login_attempts = Column(Integer, nullable=False, server_default="0", default=0)
    account_locked_until = Column(DateTime(timezone=True), nullable=True)
    last_failed_login_at = Column(DateTime(timezone=True), nullable=True)
