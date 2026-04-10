from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base
from app.core.secret_crypto import decrypt_secret_value, encrypt_secret_value
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
        default=UserRole.medical_student,
    )
    is_active = Column(Boolean, nullable=False, server_default="true", default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)
    deleted_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    restored_at = Column(DateTime(timezone=True), nullable=True, index=True)
    restored_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)

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
    patient_assignments = relationship(
        "DoctorPatientAssignment",
        back_populates="doctor",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    privileged_role_assignments = relationship(
        "UserPrivilegedRoleAssignment",
        foreign_keys="UserPrivilegedRoleAssignment.user_id",
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    # Security: brute force protection
    failed_login_attempts = Column(Integer, nullable=False, server_default="0", default=0)
    account_locked_until = Column(DateTime(timezone=True), nullable=True)
    last_failed_login_at = Column(DateTime(timezone=True), nullable=True)
    password_changed_at = Column(DateTime(timezone=True), nullable=True)

    # Security: admin MFA
    two_factor_enabled = Column(Boolean, nullable=False, server_default="false", default=False)
    _two_factor_secret_encrypted = Column("two_factor_secret", Text(), nullable=True)
    two_factor_enabled_at = Column(DateTime(timezone=True), nullable=True)

    @property
    def two_factor_secret(self) -> str | None:
        return decrypt_secret_value(
            self._two_factor_secret_encrypted,
            config_name="two_factor_secret_encryption_key",
            purpose="user.two_factor_secret",
        )

    @two_factor_secret.setter
    def two_factor_secret(self, value: str | None) -> None:
        self._two_factor_secret_encrypted = encrypt_secret_value(
            value,
            config_name="two_factor_secret_encryption_key",
            purpose="user.two_factor_secret",
        )
