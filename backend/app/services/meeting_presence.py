from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.meeting import Meeting
from app.models.meeting_room_presence import MeetingRoomPresence


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def get_or_create_presence(db: Session, meeting: Meeting) -> MeetingRoomPresence:
    presence = meeting.room_presence
    if presence:
        return presence

    presence = MeetingRoomPresence(meeting_id=meeting.id)
    db.add(presence)
    db.flush()
    meeting.room_presence = presence
    return presence


def touch_doctor_presence(db: Session, meeting: Meeting) -> MeetingRoomPresence:
    now = _now_utc()
    presence = get_or_create_presence(db, meeting)
    if presence.doctor_joined_at is None:
        presence.doctor_joined_at = now
    presence.doctor_last_seen_at = now
    presence.doctor_left_at = None
    db.add(presence)
    db.commit()
    db.refresh(presence)
    return presence


def touch_patient_presence(db: Session, meeting: Meeting) -> MeetingRoomPresence:
    now = _now_utc()
    presence = get_or_create_presence(db, meeting)
    if presence.patient_joined_at is None:
        presence.patient_joined_at = now
    presence.patient_last_seen_at = now
    presence.patient_left_at = None
    db.add(presence)
    db.commit()
    db.refresh(presence)
    return presence


def mark_doctor_left(db: Session, meeting: Meeting) -> MeetingRoomPresence:
    now = _now_utc()
    presence = get_or_create_presence(db, meeting)
    presence.doctor_left_at = now
    db.add(presence)
    db.commit()
    db.refresh(presence)
    return presence


def mark_patient_left(db: Session, meeting: Meeting) -> MeetingRoomPresence:
    now = _now_utc()
    presence = get_or_create_presence(db, meeting)
    presence.patient_left_at = now
    db.add(presence)
    db.commit()
    db.refresh(presence)
    return presence
