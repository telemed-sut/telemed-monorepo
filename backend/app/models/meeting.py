from uuid import uuid4

from sqlalchemy import Column, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base
from app.models.enums import MeetingStatus


class Meeting(Base):
    __tablename__ = "meetings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    date_time = Column(DateTime(timezone=True), nullable=True)
    description = Column(Text, nullable=True)
    doctor_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    note = Column(Text, nullable=True)
    room = Column(String(100), nullable=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("patients.id", ondelete="SET NULL"), nullable=True, index=True)
    status = Column(
        Enum(MeetingStatus, name="meetingstatus", create_constraint=True),
        nullable=False,
        server_default=MeetingStatus.scheduled.value,
        index=True,
    )
    reason = Column(Text, nullable=True)
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    cancelled_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    doctor = relationship("User", back_populates="meetings_as_doctor", foreign_keys=[doctor_id])
    patient = relationship("Patient", back_populates="meetings", foreign_keys=[user_id])
    canceller = relationship("User", foreign_keys=[cancelled_by])
