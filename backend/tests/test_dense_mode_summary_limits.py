from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models.medication import Medication
from app.models.patient import Patient
from app.services.dense_mode import SUMMARY_SECTION_LIMIT, get_patient_summary


def test_get_patient_summary_limits_active_medications(db: Session):
    patient = Patient(
        first_name="Dense",
        last_name="Mode",
        date_of_birth=date(1990, 1, 1),
    )
    db.add(patient)
    db.commit()
    db.refresh(patient)

    base_time = datetime.now(timezone.utc) - timedelta(minutes=SUMMARY_SECTION_LIMIT + 5)
    medications = [
        Medication(
            patient_id=patient.id,
            name=f"Medication {index}",
            created_at=base_time + timedelta(minutes=index),
        )
        for index in range(SUMMARY_SECTION_LIMIT + 5)
    ]
    db.add_all(medications)
    db.commit()

    summary = get_patient_summary(db, patient.id)

    assert summary is not None
    assert len(summary["active_medications"]) == SUMMARY_SECTION_LIMIT
