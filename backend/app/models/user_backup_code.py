from uuid import uuid4

from sqlalchemy import Column, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID

from app.db.base import Base


class UserBackupCode(Base):
    __tablename__ = "user_backup_codes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    code_hash = Column(String(128), nullable=False, index=True)
    batch_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=True, index=True)
