from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base
from app.models.enums import AlertCategory, AlertSeverity


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    patient_id = Column(UUID(as_uuid=True), ForeignKey("patients.id", ondelete="CASCADE"), nullable=False, index=True)
    severity = Column(Enum(AlertSeverity, name="alert_severity", create_type=False), nullable=False)
    category = Column(Enum(AlertCategory, name="alert_category", create_type=False), nullable=False)
    title = Column(String(500), nullable=False)
    message = Column(Text, nullable=True)
    is_acknowledged = Column(Boolean, default=False, nullable=False)
    acknowledged_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    patient = relationship("Patient", back_populates="alerts")
    acknowledger = relationship("User", foreign_keys=[acknowledged_by])
