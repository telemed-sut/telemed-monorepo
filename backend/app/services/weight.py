from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session
from fastapi import HTTPException, status

from app.models.weight_record import WeightRecord
from app.schemas.weight import WeightRecordCreate, WeightRecordUpdate
from app.services.patient_events import publish_patient_event_sync
from app.services.vitals import check_vitals_and_alert


def _trend_point(record: WeightRecord) -> dict[str, object]:
    return {
        "date": record.measured_at.date().isoformat(),
        "recorded_at": record.measured_at.isoformat(),
        "weight_kg": record.weight_kg,
        "height_cm": record.height_cm,
        "bmi": record.bmi,
    }


def create_weight_record(
    db: Session,
    patient_id: UUID,
    payload: WeightRecordCreate,
    recorded_by: UUID | None = None,
) -> WeightRecord:
    # measured_at is always server-generated — clients cannot supply it.
    record = WeightRecord(
        patient_id=patient_id,
        weight_kg=payload.weight_kg,
        height_cm=payload.height_cm,
        measured_at=datetime.now(timezone.utc),
        recorded_by=recorded_by,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    publish_patient_event_sync(
        patient_id=patient_id,
        event_type="new_weight_record",
        recorded_at=record.measured_at,
        data={
            "weight_id": str(record.id),
            "trend_point": _trend_point(record),
        },
    )

    # Check threshold and alert
    check_vitals_and_alert(
        db=db,
        patient_id=patient_id,
        weight_kg=record.weight_kg,
    )

    return record


def list_weight_records(db: Session, patient_id: UUID) -> list[WeightRecord]:
    return db.scalars(
        select(WeightRecord)
        .where(WeightRecord.patient_id == patient_id)
        .order_by(WeightRecord.measured_at.desc())
    ).all()


def update_weight_record(
    db: Session,
    patient_id: UUID,
    record_id: UUID,
    payload: WeightRecordUpdate,
) -> WeightRecord:
    record = db.scalars(
        select(WeightRecord)
        .where(WeightRecord.id == record_id, WeightRecord.patient_id == patient_id)
    ).first()
    
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Weight record not found")

    # measured_at is server-generated and not editable; the schema already
    # excludes it from inbound updates.
    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(record, key, value)
        
    db.commit()
    db.refresh(record)

    # Re-check threshold if weight was changed
    if "weight_kg" in update_data:
        check_vitals_and_alert(
            db=db,
            patient_id=patient_id,
            weight_kg=record.weight_kg,
        )

    return record


def delete_weight_record(
    db: Session,
    patient_id: UUID,
    record_id: UUID,
) -> WeightRecord:
    record = db.scalars(
        select(WeightRecord)
        .where(WeightRecord.id == record_id, WeightRecord.patient_id == patient_id)
    ).first()
    
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Weight record not found")

    db.delete(record)
    db.commit()
    
    return record
