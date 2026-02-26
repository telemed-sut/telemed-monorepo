from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import UUID

from app.db.base import Base


class DeviceRegistration(Base):
    __tablename__ = "device_registrations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    device_id = Column(String(128), nullable=False, unique=True, index=True)
    display_name = Column(String(200), nullable=False)
    # Shared secret must be retrievable for HMAC verification.
    device_secret = Column(String(255), nullable=False)
    notes = Column(String(500), nullable=True)
    is_active = Column(Boolean, nullable=False, server_default="true", default=True)
    last_seen_at = Column(DateTime(timezone=True), nullable=True)
    deactivated_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    updated_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_device_registrations_active_created", "is_active", "created_at"),
    )
