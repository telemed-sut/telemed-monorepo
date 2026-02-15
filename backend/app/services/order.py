import json
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.enums import OrderStatus, OrderType, TimelineEventType
from app.models.lab import Lab
from app.models.medication import Medication
from app.models.timeline_event import TimelineEvent
from app.schemas.order import NoteCreate, OrderCreate


def create_order(db: Session, patient_id: UUID, payload: OrderCreate, ordered_by: UUID):
    """Create a medication or lab order and auto-generate a timeline event."""
    if payload.order_type == OrderType.medication:
        record = Medication(
            patient_id=patient_id,
            name=payload.name,
            dosage=payload.dosage,
            frequency=payload.frequency,
            route=payload.route,
            status=OrderStatus.active,
            start_date=payload.start_date,
            ordered_by=ordered_by,
            notes=payload.notes,
        )
        db.add(record)
        db.flush()

        event = TimelineEvent(
            patient_id=patient_id,
            event_type=TimelineEventType.medication,
            title=f"Medication ordered: {payload.name}",
            summary=f"{payload.dosage or ''} {payload.frequency or ''} {payload.route or ''}".strip(),
            author_id=ordered_by,
            reference_id=record.id,
            reference_type="medication",
        )
        db.add(event)
        db.commit()
        db.refresh(record)
        return record

    elif payload.order_type in (OrderType.lab, OrderType.imaging):
        record = Lab(
            patient_id=patient_id,
            test_name=payload.name,
            category=payload.category or payload.order_type.value,
            status=OrderStatus.pending,
            ordered_by=ordered_by,
            notes=payload.notes,
        )
        db.add(record)
        db.flush()

        evt_type = TimelineEventType.lab_result if payload.order_type == OrderType.lab else TimelineEventType.imaging
        event = TimelineEvent(
            patient_id=patient_id,
            event_type=evt_type,
            title=f"{payload.order_type.value.title()} ordered: {payload.name}",
            summary=payload.notes or "",
            author_id=ordered_by,
            reference_id=record.id,
            reference_type=payload.order_type.value,
        )
        db.add(event)
        db.commit()
        db.refresh(record)
        return record


def create_progress_note(db: Session, patient_id: UUID, payload: NoteCreate, author_id: UUID):
    """Create a SOAP/progress note as a timeline event."""
    details = json.dumps({
        "note_type": payload.note_type,
        "subjective": payload.subjective,
        "objective": payload.objective,
        "assessment": payload.assessment,
        "plan": payload.plan,
    })

    event = TimelineEvent(
        patient_id=patient_id,
        event_type=TimelineEventType.note,
        title=payload.title or f"{payload.note_type.upper()} Note",
        summary=payload.assessment or payload.subjective or "",
        details=details,
        author_id=author_id,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event
