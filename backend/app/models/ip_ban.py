from uuid import uuid4

from sqlalchemy import Column, DateTime, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID

from app.db.base import Base


class IPBan(Base):
    __tablename__ = "ip_bans"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    ip_address = Column(String(45), nullable=False, unique=True, index=True)
    reason = Column(String(500), nullable=True)
    failed_attempts = Column(Integer, default=0, nullable=False)
    banned_until = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
