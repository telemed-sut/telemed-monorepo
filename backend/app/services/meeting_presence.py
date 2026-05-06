from datetime import datetime, timezone
import logging
from threading import Event, Lock, Thread

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.enums import MeetingStatus

from app.models.meeting import Meeting
from app.models.meeting_room_presence import MeetingRoomPresence
from app.models.meeting_room_presence import ROOM_PRESENCE_HEARTBEAT_TIMEOUT_SECONDS

settings = get_settings()
logger = logging.getLogger(__name__)
_reconcile_worker_lock = Lock()
_reconcile_worker_stop = Event()
_reconcile_worker_thread: Thread | None = None
_PRESENCE_DB_FLUSH_INTERVAL_SECONDS = 10
_UNSET = object()

def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _write_presence_runtime_state(
    *,
    meeting_id,
    doctor_last_seen_at: datetime | None | object = _UNSET,
    patient_last_seen_at: datetime | None | object = _UNSET,
    doctor_left_at: datetime | None | object = _UNSET,
    patient_left_at: datetime | None | object = _UNSET,
    refreshed_at: datetime | None | object = _UNSET,
) -> None:
    return None


def _read_presence_runtime_state(meeting_id) -> dict[str, datetime | None]:
    return {}


def apply_runtime_presence_overlay(presence: MeetingRoomPresence | None) -> MeetingRoomPresence | None:
    if presence is None:
        return None

    runtime_state = _read_presence_runtime_state(presence.meeting_id)
    if not runtime_state:
        return presence

    for field_name, value in runtime_state.items():
        setattr(presence, field_name, value)

    return presence


def _should_flush_presence_timestamp(current_value: datetime | None, now: datetime) -> bool:
    normalized = MeetingRoomPresence._ensure_utc(current_value)
    if normalized is None:
        return True
    return (now - normalized).total_seconds() >= _PRESENCE_DB_FLUSH_INTERVAL_SECONDS


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
    first_join = presence.doctor_joined_at is None
    if first_join:
        presence.doctor_joined_at = now
    _write_presence_runtime_state(
        meeting_id=meeting.id,
        doctor_last_seen_at=now,
        doctor_left_at=None,
        refreshed_at=now,
    )

    if first_join or presence.doctor_left_at is not None or _should_flush_presence_timestamp(presence.doctor_last_seen_at, now):
        presence.doctor_last_seen_at = now
        presence.doctor_left_at = None
        presence.refreshed_at = now
        db.add(presence)
        db.commit()
        db.refresh(presence)

    return apply_runtime_presence_overlay(presence) or presence


def touch_patient_presence(db: Session, meeting: Meeting) -> MeetingRoomPresence:
    now = _now_utc()
    presence = get_or_create_presence(db, meeting)
    first_join = presence.patient_joined_at is None
    if first_join:
        presence.patient_joined_at = now
    _write_presence_runtime_state(
        meeting_id=meeting.id,
        patient_last_seen_at=now,
        patient_left_at=None,
        refreshed_at=now,
    )

    if first_join or presence.patient_left_at is not None or _should_flush_presence_timestamp(presence.patient_last_seen_at, now):
        presence.patient_last_seen_at = now
        presence.patient_left_at = None
        presence.refreshed_at = now
        db.add(presence)
        db.commit()
        db.refresh(presence)

    return apply_runtime_presence_overlay(presence) or presence


def mark_doctor_left(db: Session, meeting: Meeting) -> MeetingRoomPresence:
    now = _now_utc()
    presence = get_or_create_presence(db, meeting)
    _write_presence_runtime_state(
        meeting_id=meeting.id,
        doctor_left_at=now,
        refreshed_at=now,
    )
    presence.doctor_left_at = now
    presence.refreshed_at = now
    db.add(presence)
    db.commit()
    db.refresh(presence)
    return apply_runtime_presence_overlay(presence) or presence


def mark_patient_left(db: Session, meeting: Meeting) -> MeetingRoomPresence:
    now = _now_utc()
    presence = get_or_create_presence(db, meeting)
    _write_presence_runtime_state(
        meeting_id=meeting.id,
        patient_left_at=now,
        refreshed_at=now,
    )
    presence.patient_left_at = now
    presence.refreshed_at = now
    db.add(presence)
    db.commit()
    db.refresh(presence)
    return apply_runtime_presence_overlay(presence) or presence


def _derive_active_meeting_status(presence: MeetingRoomPresence) -> MeetingStatus:
    if presence.patient_online and presence.doctor_online:
        return MeetingStatus.in_progress
    if presence.patient_online:
        return MeetingStatus.waiting
    return MeetingStatus.scheduled


def _seconds_since(
    occurred_at: datetime | None,
    *,
    now: datetime,
) -> int | None:
    normalized = MeetingRoomPresence._ensure_utc(occurred_at)
    if normalized is None:
        return None
    delta = now - normalized
    return max(0, int(delta.total_seconds()))


def reconcile_active_meeting_status(
    db: Session,
    meeting: Meeting,
    presence: MeetingRoomPresence,
) -> bool:
    apply_runtime_presence_overlay(presence)
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


def reconcile_active_meetings_in_new_session(*, force: bool = False) -> int:
    with SessionLocal() as db:
        return reconcile_active_meetings(db, force=force)


def start_reconcile_worker() -> None:
    if settings.app_env == "test":
        return

    interval_seconds = settings.meeting_presence_reconcile_interval_seconds
    if interval_seconds <= 0:
        return

    global _reconcile_worker_thread
    with _reconcile_worker_lock:
        if _reconcile_worker_thread is not None and _reconcile_worker_thread.is_alive():
            return

        _reconcile_worker_stop.clear()

        def _worker() -> None:
            while not _reconcile_worker_stop.wait(interval_seconds):
                try:
                    reconcile_active_meetings_in_new_session()
                except Exception:
                    logger.exception("Meeting presence reconciliation worker failed.")

        _reconcile_worker_thread = Thread(
            target=_worker,
            name="meeting-presence-reconcile-worker",
            daemon=True,
        )
        _reconcile_worker_thread.start()


def stop_reconcile_worker() -> None:
    global _reconcile_worker_thread
    with _reconcile_worker_lock:
        thread = _reconcile_worker_thread
        _reconcile_worker_stop.set()
        _reconcile_worker_thread = None
    if thread is not None and thread.is_alive():
        thread.join(timeout=max(1, min(settings.meeting_presence_reconcile_interval_seconds, 5)))


def build_reliability_snapshot(
    *,
    meeting: Meeting,
    presence: MeetingRoomPresence | None,
    checked_at: datetime | None = None,
    meeting_status_before_reconcile: MeetingStatus | None = None,
) -> dict:
    checked = checked_at or _now_utc()
    presence = apply_runtime_presence_overlay(presence)
    projected_status = (
        _derive_active_meeting_status(presence)
        if presence is not None
        else MeetingStatus.scheduled
    )
    current_status = meeting.status
    status_before_reconcile = meeting_status_before_reconcile or current_status
    status_in_sync = (
        current_status == projected_status
        if current_status in (
            MeetingStatus.scheduled,
            MeetingStatus.waiting,
            MeetingStatus.in_progress,
        )
        else None
    )

    return {
        "meeting_id": str(meeting.id),
        "checked_at": checked,
        "heartbeat_timeout_seconds": ROOM_PRESENCE_HEARTBEAT_TIMEOUT_SECONDS,
        "meeting_status": current_status.value,
        "meeting_status_before_reconcile": status_before_reconcile.value,
        "meeting_status_reconciled": status_before_reconcile != current_status,
        "active_status_projection": projected_status.value,
        "status_in_sync": status_in_sync,
        "room_presence_state": presence.state if presence is not None else "none",
        "doctor_online": presence.doctor_online if presence is not None else False,
        "patient_online": presence.patient_online if presence is not None else False,
        "doctor_presence_stale": not presence.doctor_online if presence is not None else True,
        "patient_presence_stale": not presence.patient_online if presence is not None else True,
        "doctor_last_seen_at": presence.doctor_last_seen_at if presence is not None else None,
        "patient_last_seen_at": presence.patient_last_seen_at if presence is not None else None,
        "doctor_last_seen_age_seconds": (
            _seconds_since(presence.doctor_last_seen_at, now=checked)
            if presence is not None
            else None
        ),
        "patient_last_seen_age_seconds": (
            _seconds_since(presence.patient_last_seen_at, now=checked)
            if presence is not None
            else None
        ),
        "doctor_left_at": presence.doctor_left_at if presence is not None else None,
        "patient_left_at": presence.patient_left_at if presence is not None else None,
        "refreshed_at": presence.refreshed_at if presence is not None else None,
        "updated_at": presence.updated_at if presence is not None else None,
    }
