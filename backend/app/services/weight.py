from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session
from fastapi import HTTPException, status

from app.models.weight_record import WeightRecord
from app.schemas.weight import WeightRecordCreate, WeightRecordUpdate
from app.services.vitals import check_vitals_and_alert


def create_weight_record(
    db: Session,
    patient_id: UUID,
    payload: WeightRecordCreate,
    recorded_by: UUID | None = None,
) -> WeightRecord:
    measured_at = payload.measured_at or datetime.now(timezone.utc)
    if measured_at.tzinfo is None:
        measured_at = measured_at.replace(tzinfo=timezone.utc)

    record = WeightRecord(
        patient_id=patient_id,
        weight_kg=payload.weight_kg,
        height_cm=payload.height_cm,
        measured_at=measured_at,
        recorded_by=recorded_by,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

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

    update_data = payload.model_dump(exclude_unset=True)
    if "measured_at" in update_data and update_data["measured_at"] is not None:
        measured_at = update_data["measured_at"]
        if measured_at.tzinfo is None:
            update_data["measured_at"] = measured_at.replace(tzinfo=timezone.utc)

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

