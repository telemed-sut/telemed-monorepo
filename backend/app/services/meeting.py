from contextlib import contextmanager
from datetime import datetime, timezone
from typing import List, Optional, Tuple
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.core.config import get_settings
from app.models.doctor_patient_assignment import DoctorPatientAssignment
from app.models.enums import MeetingStatus
from app.models.meeting import Meeting
from app.schemas.meeting import MeetingCreate, MeetingUpdate
from app.services import meeting_presence as meeting_presence_service
from app.services import meeting_video as meeting_video_service

settings = get_settings()


def is_patient_assigned_to_doctor(db: Session, doctor_id: UUID, patient_id: UUID) -> bool:
    assignment_id = db.scalar(
        select(DoctorPatientAssignment.id).where(
            DoctorPatientAssignment.doctor_id == doctor_id,
            DoctorPatientAssignment.patient_id == patient_id,
        )
    )
    return assignment_id is not None


def build_doctor_visibility_clause(doctor_id: UUID):
    assigned_patient_ids = select(DoctorPatientAssignment.patient_id).where(
        DoctorPatientAssignment.doctor_id == doctor_id
    )
    return or_(
        Meeting.doctor_id == doctor_id,
        Meeting.user_id.in_(assigned_patient_ids),
    )


def can_doctor_view_meeting(db: Session, doctor_id: UUID, meeting: Meeting) -> bool:
    if meeting.doctor_id == doctor_id:
        return True
    if not meeting.user_id:
        return False
    return is_patient_assigned_to_doctor(db, doctor_id, meeting.user_id)


def can_assigned_user_view_meeting(db: Session, user_id: UUID, meeting: Meeting) -> bool:
    return can_doctor_view_meeting(db, user_id, meeting)


def can_doctor_edit_meeting(doctor_id: UUID, meeting: Meeting) -> bool:
    return meeting.doctor_id == doctor_id


def _apply_list_filters(
    stmt,
    *,
    q: Optional[str],
    doctor_id: Optional[str],
    patient_id: Optional[str],
    status_filter: Optional[str],
):
    # Filter by doctor
    if doctor_id:
        try:
            stmt = stmt.where(Meeting.doctor_id == UUID(doctor_id))
        except ValueError:
            pass

    # Filter by patient
    if patient_id:
        try:
            stmt = stmt.where(Meeting.user_id == UUID(patient_id))
        except ValueError:
            pass

    # Filter by status
    if status_filter:
        try:
            status_enum = MeetingStatus(status_filter)
            stmt = stmt.where(Meeting.status == status_enum)
        except ValueError:
            pass

    # Search in description, note, room
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(
            or_(
                Meeting.description.ilike(pattern),
                Meeting.note.ilike(pattern),
                Meeting.room.ilike(pattern),
            )
        )

    return stmt


from fastapi import HTTPException, status


@contextmanager
def _local_meeting_creation_lock(lock_name: str):
    yield True

def create_meeting(db: Session, payload: MeetingCreate) -> Meeting:
    # 1. Keep the critical section shape while relying on the database uniqueness check.
    # Normalize time to minutes to prevent minor variations from bypassing the lock
    time_str = payload.date_time.strftime("%Y%m%d%H%M")
    lock_name = f"create_meeting:{payload.doctor_id}:{time_str}"
    
    with _local_meeting_creation_lock(lock_name) as acquired:
        if not acquired:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Could not acquire lock for meeting creation. Please try again."
            )
            
        # 2. Check for existing overlapping meetings within the lock
        # For simplicity, we check for meetings at the exact same start time
        # In a real system, you might check for overlapping duration (e.g. start < end and end > start)
        existing = db.scalar(
            select(Meeting).where(
                Meeting.doctor_id == payload.doctor_id,
                Meeting.date_time == payload.date_time,
                Meeting.status != MeetingStatus.cancelled
            )
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The doctor already has a meeting scheduled at this time."
            )

        # 3. Create the meeting
        meeting = Meeting(**payload.model_dump())
        db.add(meeting)
        db.commit()
        db.refresh(meeting)
        
    if meeting.user_id and meeting.status not in (
        MeetingStatus.cancelled,
        MeetingStatus.completed,
    ):
        meeting_video_service.ensure_patient_join_invite(
            db=db,
            meeting=meeting,
        )
        
    # Reload with relationships
    return get_meeting(db, str(meeting.id))


def get_meeting(db: Session, meeting_id: str) -> Optional[Meeting]:
    try:
        uuid_id = UUID(meeting_id)
        stmt = (
            select(Meeting)
            .options(
                joinedload(Meeting.doctor),
                joinedload(Meeting.patient),
                joinedload(Meeting.room_presence),
            )
            .where(Meeting.id == uuid_id)
        )
        meeting = db.scalar(stmt)
        if meeting and meeting.room_presence:
            meeting_presence_service.apply_runtime_presence_overlay(meeting.room_presence)
        return meeting
    except ValueError:
        return None


def update_meeting(
    db: Session,
    meeting: Meeting,
    payload: MeetingUpdate,
    actor_id: Optional[UUID] = None,
) -> Meeting:
    data = payload.model_dump(exclude_unset=True)
    original_patient_id = meeting.user_id
    original_status = meeting.status

    # Handle cancellation metadata
    if data.get("status") == MeetingStatus.cancelled and meeting.status != MeetingStatus.cancelled:
        data["cancelled_at"] = datetime.now(timezone.utc)
        if actor_id:
            data["cancelled_by"] = actor_id

    for key, value in data.items():
        setattr(meeting, key, value)
    db.add(meeting)
    db.commit()
    db.refresh(meeting)

    patient_changed = original_patient_id != meeting.user_id
    is_joinable = meeting.user_id and meeting.status not in (
        MeetingStatus.cancelled,
        MeetingStatus.completed,
    )

    if patient_changed or (
        original_status not in (MeetingStatus.cancelled, MeetingStatus.completed)
        and meeting.status in (MeetingStatus.cancelled, MeetingStatus.completed)
    ) or not meeting.user_id:
        meeting_video_service.deactivate_patient_join_invites(
            db=db,
            meeting=meeting,
            clear_meeting_url=True,
        )
        db.refresh(meeting)

    if is_joinable:
        meeting_video_service.ensure_patient_join_invite(
            db=db,
            meeting=meeting,
            created_by_user_id=str(actor_id) if actor_id else None,
        )

    # Reload with relationships
    return get_meeting(db, str(meeting.id))


def delete_meeting(db: Session, meeting: Meeting) -> None:
    db.delete(meeting)
    db.commit()


def list_meetings(
    db: Session,
    page: int,
    limit: int,
    q: Optional[str] = None,
    doctor_id: Optional[str] = None,
    patient_id: Optional[str] = None,
    sort: str = "date_time",
    order: str = "desc",
    status_filter: Optional[str] = None,
    visible_doctor_id: Optional[UUID] = None,
) -> Tuple[List[Meeting], int]:
    stmt = select(Meeting).options(
        joinedload(Meeting.doctor),
        joinedload(Meeting.patient),
        joinedload(Meeting.room_presence),
    )

    if visible_doctor_id:
        stmt = stmt.where(build_doctor_visibility_clause(visible_doctor_id))
    stmt = _apply_list_filters(
        stmt,
        q=q,
        doctor_id=doctor_id,
        patient_id=patient_id,
        status_filter=status_filter,
    )

    # Count total
    count_base = select(Meeting)
    if visible_doctor_id:
        count_base = count_base.where(build_doctor_visibility_clause(visible_doctor_id))
    count_base = _apply_list_filters(
        count_base,
        q=q,
        doctor_id=doctor_id,
        patient_id=patient_id,
        status_filter=status_filter,
    )
    total = db.scalar(select(func.count()).select_from(count_base.subquery()))

    # Sorting
    sort_field = {
        "date_time": Meeting.date_time,
        "created_at": Meeting.created_at,
        "updated_at": Meeting.updated_at,
        "room": Meeting.room,
        "status": Meeting.status,
    }.get(sort, Meeting.date_time)

    sort_clause = sort_field.desc() if order.lower() == "desc" else sort_field.asc()
    stmt = stmt.order_by(sort_clause)

    # Pagination
    safe_limit = min(limit, settings.max_limit)
    offset = (page - 1) * safe_limit
    stmt = stmt.limit(safe_limit).offset(offset)

    items = db.scalars(stmt).unique().all()
    for meeting in items:
        if meeting.room_presence:
            meeting_presence_service.apply_runtime_presence_overlay(meeting.room_presence)
    return items, total
