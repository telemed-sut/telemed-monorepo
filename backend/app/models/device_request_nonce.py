from datetime import datetime

from sqlalchemy import DateTime, Index, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DeviceRequestNonce(Base):
    __tablename__ = "device_request_nonces"

    id: Mapped[int] = mapped_column(primary_key=True, index=True, autoincrement=True)
    device_id: Mapped[str] = mapped_column(String(128), nullable=False)
    nonce_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    __table_args__ = (
        UniqueConstraint("device_id", "nonce_hash", name="uq_device_request_nonces_device_nonce"),
        Index("ix_device_request_nonces_expires_at", "expires_at"),
        Index("ix_device_request_nonces_device_id_created_at", "device_id", "created_at"),
    )
