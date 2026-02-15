from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models.timeline_event import TimelineEvent


def get_patient_timeline(
    db: Session,
    patient_id: UUID,
    cursor: Optional[str] = None,
    limit: int = 20,
) -> dict:
    """Fetch paginated clinical timeline events for a patient using cursor pagination."""
    stmt = (
        select(TimelineEvent)
        .options(joinedload(TimelineEvent.author))
        .where(TimelineEvent.patient_id == patient_id)
    )

    if cursor:
        cursor_dt = datetime.fromisoformat(cursor)
        stmt = stmt.where(TimelineEvent.event_time < cursor_dt)

    stmt = stmt.order_by(TimelineEvent.event_time.desc()).limit(limit + 1)
    events = list(db.scalars(stmt).unique().all())

    has_more = len(events) > limit
    items = events[:limit]

    # Enrich with author name
    enriched = []
    for e in items:
        author_name = None
        if e.author:
            author_name = f"{e.author.first_name or ''} {e.author.last_name or ''}".strip() or None
        enriched.append({
            "id": e.id,
            "patient_id": e.patient_id,
            "event_type": e.event_type,
            "event_time": e.event_time,
            "title": e.title,
            "summary": e.summary,
            "details": e.details,
            "is_abnormal": e.is_abnormal,
            "author_id": e.author_id,
            "author_name": author_name,
            "reference_id": e.reference_id,
            "reference_type": e.reference_type,
            "created_at": e.created_at,
        })

    next_cursor = None
    if has_more and items:
        next_cursor = items[-1].event_time.isoformat()

    return {
        "items": enriched,
        "next_cursor": next_cursor,
        "has_more": has_more,
    }
