from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID

from app.db.base import Base
from app.models.enums import UserRole


class UserInvite(Base):
    __tablename__ = "user_invites"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    token_hash = Column(String(64), nullable=False, unique=True, index=True)
    email = Column(String(255), nullable=False, index=True)
    role = Column(
        Enum(UserRole, name="user_role", create_type=False),
        nullable=False,
        default=UserRole.medical_student,
    )
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    def is_used(self) -> bool:
        return self.used_at is not None

    def is_expired(self, now: datetime) -> bool:
        return self.expires_at <= now
