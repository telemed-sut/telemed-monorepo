from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.weight_record import WeightRecord
from app.schemas.weight import WeightRecordCreate
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
