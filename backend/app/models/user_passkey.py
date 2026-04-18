from uuid import uuid4
from sqlalchemy import Column, DateTime, ForeignKey, Integer, LargeBinary, String, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship

from app.db.base import Base

class UserPasskey(Base):
    __tablename__ = "user_passkeys"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # WebAuthn specific fields
    credential_id = Column(String(512), unique=True, nullable=False, index=True)
    public_key = Column(LargeBinary, nullable=False)
    sign_count = Column(Integer, nullable=False, default=0)
    transports = Column(JSONB, nullable=True)  # List of strings e.g. ["internal", "usb"]
    
    # Metadata
    name = Column(String(100), nullable=True)  # User-defined name for the device
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_used_at = Column(DateTime(timezone=True), nullable=True)

    # Relationship
    user = relationship("User", backref="passkeys")
