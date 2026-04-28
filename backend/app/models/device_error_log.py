from datetime import datetime
from sqlalchemy import DateTime, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base

class DeviceErrorLog(Base):
    __tablename__ = "device_error_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    device_id: Mapped[str] = mapped_column(String, index=True, nullable=True)
    error_message: Mapped[str] = mapped_column(Text, nullable=False)
    ip_address: Mapped[str] = mapped_column(String, nullable=True)
    endpoint: Mapped[str] = mapped_column(String, nullable=True)
    
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_device_error_logs_occurred_at", "occurred_at"),
        Index("ix_device_error_logs_device_id_occurred_at", "device_id", "occurred_at"),
    )
