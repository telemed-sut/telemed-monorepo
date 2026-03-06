from datetime import datetime, timedelta, timezone

from sqlalchemy import Column, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base

ROOM_PRESENCE_HEARTBEAT_TIMEOUT_SECONDS = 25


class MeetingRoomPresence(Base):
    __tablename__ = "meeting_room_presence"

    meeting_id = Column(
        UUID(as_uuid=True),
        ForeignKey("meetings.id", ondelete="CASCADE"),
        primary_key=True,
    )
    doctor_joined_at = Column(DateTime(timezone=True), nullable=True)
    doctor_last_seen_at = Column(DateTime(timezone=True), nullable=True)
    doctor_left_at = Column(DateTime(timezone=True), nullable=True)

    patient_joined_at = Column(DateTime(timezone=True), nullable=True)
    patient_last_seen_at = Column(DateTime(timezone=True), nullable=True)
    patient_left_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    refreshed_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    meeting = relationship("Meeting", back_populates="room_presence")

    @staticmethod
    def _ensure_utc(dt: datetime | None) -> datetime | None:
        if dt is None:
            return None
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt

    def _is_online(
        self,
        *,
        last_seen_at: datetime | None,
        left_at: datetime | None,
        now: datetime | None = None,
    ) -> bool:
        if not last_seen_at:
            return False
        last_seen_at = self._ensure_utc(last_seen_at)
        left_at = self._ensure_utc(left_at)
        if left_at and left_at >= last_seen_at:
            return False
        current_time = now or datetime.now(timezone.utc)
        return last_seen_at >= current_time - timedelta(seconds=ROOM_PRESENCE_HEARTBEAT_TIMEOUT_SECONDS)

    @property
    def doctor_online(self) -> bool:
        return self._is_online(
            last_seen_at=self.doctor_last_seen_at,
            left_at=self.doctor_left_at,
        )

    @property
    def patient_online(self) -> bool:
        return self._is_online(
            last_seen_at=self.patient_last_seen_at,
            left_at=self.patient_left_at,
        )

    @property
    def state(self) -> str:
        doctor_online = self.doctor_online
        patient_online = self.patient_online

        if doctor_online and patient_online:
            return "both_in_room"
        if patient_online and not doctor_online:
            doctor_was_in_room = self.doctor_joined_at is not None
            doctor_explicitly_left = (
                self.doctor_left_at is not None
                and (self.doctor_last_seen_at is None or self.doctor_left_at >= self.doctor_last_seen_at)
            )
            if doctor_was_in_room and doctor_explicitly_left:
                return "doctor_left_patient_waiting"
            return "patient_waiting"
        if doctor_online and not patient_online:
            return "doctor_only"
        return "none"
