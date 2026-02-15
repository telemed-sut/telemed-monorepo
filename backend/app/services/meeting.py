from datetime import datetime, timezone
from typing import List, Optional, Tuple
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.core.config import get_settings
from app.models.enums import MeetingStatus
from app.models.meeting import Meeting
from app.models.patient import Patient
from app.models.user import User
from app.schemas.meeting import MeetingCreate, MeetingUpdate

settings = get_settings()


def create_meeting(db: Session, payload: MeetingCreate) -> Meeting:
    meeting = Meeting(**payload.model_dump())
    db.add(meeting)
    db.commit()
    db.refresh(meeting)
    # Reload with relationships
    return get_meeting(db, str(meeting.id))


def get_meeting(db: Session, meeting_id: str) -> Optional[Meeting]:
    try:
        uuid_id = UUID(meeting_id)
        stmt = (
            select(Meeting)
            .options(joinedload(Meeting.doctor), joinedload(Meeting.patient))
            .where(Meeting.id == uuid_id)
        )
        return db.scalar(stmt)
    except ValueError:
        return None


def update_meeting(
    db: Session,
    meeting: Meeting,
    payload: MeetingUpdate,
    actor_id: Optional[UUID] = None,
) -> Meeting:
    data = payload.model_dump(exclude_unset=True)

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
) -> Tuple[List[Meeting], int]:
    stmt = select(Meeting).options(
        joinedload(Meeting.doctor),
        joinedload(Meeting.patient),
    )

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

    # Count total
    count_base = select(Meeting)
    if doctor_id:
        try:
            count_base = count_base.where(Meeting.doctor_id == UUID(doctor_id))
        except ValueError:
            pass
    if patient_id:
        try:
            count_base = count_base.where(Meeting.user_id == UUID(patient_id))
        except ValueError:
            pass
    if status_filter:
        try:
            status_enum = MeetingStatus(status_filter)
            count_base = count_base.where(Meeting.status == status_enum)
        except ValueError:
            pass
    if q:
        pattern = f"%{q}%"
        count_base = count_base.where(
            or_(
                Meeting.description.ilike(pattern),
                Meeting.note.ilike(pattern),
                Meeting.room.ilike(pattern),
            )
        )
    total = db.scalar(select(func.count()).select_from(count_base.subquery()))

    # Sorting
    sort_field = {
        "date_time": Meeting.date_time,
        "created_at": Meeting.created_at,
        "updated_at": Meeting.updated_at,
        "room": Meeting.room,
    }.get(sort, Meeting.date_time)

    sort_clause = sort_field.desc() if order.lower() == "desc" else sort_field.asc()
    stmt = stmt.order_by(sort_clause)

    # Pagination
    safe_limit = min(limit, settings.max_limit)
    offset = (page - 1) * safe_limit
    stmt = stmt.limit(safe_limit).offset(offset)

    items = db.scalars(stmt).unique().all()
    return items, total
