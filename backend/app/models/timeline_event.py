from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base
from app.models.enums import TimelineEventType


class TimelineEvent(Base):
    __tablename__ = "timeline_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    patient_id = Column(UUID(as_uuid=True), ForeignKey("patients.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type = Column(Enum(TimelineEventType, name="timeline_event_type", create_type=False), nullable=False)
    event_time = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    title = Column(String(500), nullable=False)
    summary = Column(Text, nullable=True)
    details = Column(Text, nullable=True)
    is_abnormal = Column(Boolean, default=False, nullable=False)
    author_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reference_id = Column(UUID(as_uuid=True), nullable=True)
    reference_type = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    patient = relationship("Patient", back_populates="timeline_events")
    author = relationship("User", foreign_keys=[author_id])
