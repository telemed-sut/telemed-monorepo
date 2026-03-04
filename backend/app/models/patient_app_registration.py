"""Patient mobile-app registration codes and PIN credentials.

Flow:
1. Staff generates a 6-char registration code for a patient (stored here).
2. Patient opens Flutter app → enters phone + registration code.
3. Backend verifies (phone matches patient record + code matches) → patient sets a 4-digit PIN.
4. PIN hash is stored on the Patient row; this table tracks code lifecycle.
"""

from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID

from app.db.base import Base


class PatientAppRegistration(Base):
    __tablename__ = "patient_app_registrations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    patient_id = Column(
        UUID(as_uuid=True),
        ForeignKey("patients.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    code = Column(String(10), nullable=False, unique=True, index=True)
    is_used = Column(Boolean, nullable=False, server_default="false", default=False)
    used_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
