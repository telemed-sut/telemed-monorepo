from uuid import uuid4

from sqlalchemy import Column, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base
from app.models.enums import OrderStatus


class Medication(Base):
    __tablename__ = "medications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    patient_id = Column(UUID(as_uuid=True), ForeignKey("patients.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(300), nullable=False)
    dosage = Column(String(200), nullable=True)
    frequency = Column(String(200), nullable=True)
    route = Column(String(100), nullable=True)
    status = Column(Enum(OrderStatus, name="order_status", create_type=False), nullable=False, default=OrderStatus.active)
    start_date = Column(DateTime(timezone=True), nullable=True)
    end_date = Column(DateTime(timezone=True), nullable=True)
    ordered_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    patient = relationship("Patient", back_populates="medications")
    ordering_doctor = relationship("User", foreign_keys=[ordered_by])
