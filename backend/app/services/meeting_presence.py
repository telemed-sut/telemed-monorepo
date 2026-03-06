from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models.enums import MeetingStatus

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
    presence.refreshed_at = now
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
    presence.refreshed_at = now
    db.add(presence)
    db.commit()
    db.refresh(presence)
    return presence


def mark_doctor_left(db: Session, meeting: Meeting) -> MeetingRoomPresence:
    now = _now_utc()
    presence = get_or_create_presence(db, meeting)
    presence.doctor_left_at = now
    presence.refreshed_at = now
    db.add(presence)
    db.commit()
    db.refresh(presence)
    return presence


def mark_patient_left(db: Session, meeting: Meeting) -> MeetingRoomPresence:
    now = _now_utc()
    presence = get_or_create_presence(db, meeting)
    presence.patient_left_at = now
    presence.refreshed_at = now
    db.add(presence)
    db.commit()
    db.refresh(presence)
    return presence


def _derive_active_meeting_status(presence: MeetingRoomPresence) -> MeetingStatus:
    if presence.patient_online and presence.doctor_online:
        return MeetingStatus.in_progress
    if presence.patient_online:
        return MeetingStatus.waiting
    return MeetingStatus.scheduled


def reconcile_active_meeting_status(
    db: Session,
    meeting: Meeting,
    presence: MeetingRoomPresence,
) -> bool:
    if meeting.status not in (
        MeetingStatus.scheduled,
        MeetingStatus.waiting,
        MeetingStatus.in_progress,
    ):
        return False

    next_status = _derive_active_meeting_status(presence)
    if meeting.status == next_status:
        return False

    meeting.status = next_status
    db.add(meeting)
    return True


def reconcile_active_meetings(db: Session, *, force: bool = False) -> int:
    stmt = (
        select(MeetingRoomPresence)
        .join(Meeting, Meeting.id == MeetingRoomPresence.meeting_id)
        .where(Meeting.status.in_([
            MeetingStatus.scheduled,
            MeetingStatus.waiting,
            MeetingStatus.in_progress,
        ]))
        .options(joinedload(MeetingRoomPresence.meeting))
    )
    presences = db.scalars(stmt).all()

    changed = 0
    for presence in presences:
        meeting = presence.meeting
        if not meeting:
            continue
        if reconcile_active_meeting_status(db, meeting, presence):
            changed += 1

    if changed:
        db.commit()
    return changed
