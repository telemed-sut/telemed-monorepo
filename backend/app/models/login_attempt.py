from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID

from app.db.base import Base


class LoginAttempt(Base):
    __tablename__ = "login_attempts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    ip_address = Column(String(45), nullable=False, index=True)
    email = Column(String(255), nullable=False)
    success = Column(Boolean, nullable=False, default=False)
    details = Column(String(255), nullable=True)  # Added for failure reasons (e.g. "Rate Limit Exceeded")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
