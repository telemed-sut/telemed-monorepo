from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.orm import Session, joinedload

from app.models.alert import Alert
from app.models.current_condition import CurrentCondition
from app.models.doctor_patient_assignment import DoctorPatientAssignment
from app.models.encounter import Encounter
from app.models.enums import EncounterStatus, OrderStatus
from app.models.lab import Lab
from app.models.medication import Medication
from app.models.patient import Patient
from app.models.treatment import Treatment


def get_patient_summary(db: Session, patient_id: UUID) -> dict | None:
    """Fetch all data needed for the dense mode summary panel."""
    patient = db.scalar(select(Patient).where(Patient.id == patient_id))
    if not patient:
        return None

    # Active encounter
    active_encounter = db.scalar(
        select(Encounter)
        .where(and_(Encounter.patient_id == patient_id, Encounter.status == EncounterStatus.active))
        .order_by(Encounter.admitted_at.desc())
    )

    # Active medications
    active_meds = db.scalars(
        select(Medication)
        .where(and_(Medication.patient_id == patient_id, Medication.status == OrderStatus.active))
        .order_by(Medication.created_at.desc())
    ).all()

    # Pending labs
    pending_labs = db.scalars(
        select(Lab)
        .where(and_(Lab.patient_id == patient_id, Lab.status.in_([OrderStatus.pending, OrderStatus.active])))
        .order_by(Lab.ordered_at.desc())
    ).all()

    # Active alerts (unacknowledged)
    active_alerts = db.scalars(
        select(Alert)
        .where(and_(Alert.patient_id == patient_id, Alert.is_acknowledged == False))  # noqa: E712
        .order_by(Alert.created_at.desc())
    ).all()

    # Current conditions
    conditions = db.scalars(
        select(CurrentCondition)
        .where(and_(CurrentCondition.patient_id == patient_id, CurrentCondition.is_active == True))  # noqa: E712
    ).all()

    # Active treatments
    treatments = db.scalars(
        select(Treatment)
        .where(and_(Treatment.patient_id == patient_id, Treatment.is_active == True))  # noqa: E712
    ).all()

    # Assigned doctors
    assignments = db.scalars(
        select(DoctorPatientAssignment)
        .options(joinedload(DoctorPatientAssignment.doctor))
        .where(DoctorPatientAssignment.patient_id == patient_id)
    ).unique().all()

    return {
        "patient": patient,
        "active_encounter": active_encounter,
        "active_medications": list(active_meds),
        "pending_labs": list(pending_labs),
        "active_alerts": list(active_alerts),
        "current_conditions": list(conditions),
        "active_treatments": list(treatments),
        "assigned_doctors": [
            {
                "id": str(a.doctor.id),
                "name": f"{a.doctor.first_name or ''} {a.doctor.last_name or ''}".strip(),
                "role": a.role,
            }
            for a in assignments
            if a.doctor
        ],
    }
