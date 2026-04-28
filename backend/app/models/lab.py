from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base
from app.models.enums import OrderStatus


class Lab(Base):
    __tablename__ = "labs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    patient_id = Column(UUID(as_uuid=True), ForeignKey("patients.id", ondelete="CASCADE"), nullable=False, index=True)
    test_name = Column(String(300), nullable=False)
    category = Column(String(100), nullable=True)
    status = Column(Enum(OrderStatus, name="order_status", create_type=False), nullable=False, default=OrderStatus.pending)
    ordered_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    resulted_at = Column(DateTime(timezone=True), nullable=True)
    result_value = Column(String(200), nullable=True)
    result_unit = Column(String(50), nullable=True)
    reference_range = Column(String(100), nullable=True)
    is_abnormal = Column(Boolean, default=False, nullable=False)
    ordered_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    patient = relationship("Patient", back_populates="labs")
    ordering_doctor = relationship("User", foreign_keys=[ordered_by])
