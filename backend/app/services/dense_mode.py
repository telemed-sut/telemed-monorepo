import json
from uuid import UUID

from sqlalchemy import and_, cast, func, literal, select
from sqlalchemy.dialects.postgresql import JSONB
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

SUMMARY_SECTION_LIMIT = 50


def _jsonb_payload(*, dialect_name: str, **fields: object):
    args: list[object] = []
    for key, value in fields.items():
        args.extend([key, value])

    if dialect_name == "sqlite":
        return cast(func.json_object(*args), JSONB)

    return cast(func.jsonb_build_object(*args), JSONB)


def _summary_section_stmt(section: str, sort_key, payload):
    return select(
        literal(section).label("section"),
        sort_key.label("sort_key"),
        payload.label("payload"),
    )


def _fetch_summary_section(
    db: Session,
    *,
    section: str,
    sort_key,
    payload,
    where_clause,
):
    return db.execute(
        _summary_section_stmt(section, sort_key, payload)
        .where(where_clause)
        .order_by(sort_key.desc())
        .limit(SUMMARY_SECTION_LIMIT)
    ).all()


def get_patient_summary(db: Session, patient_id: UUID) -> dict | None:
    """Fetch all data needed for the dense mode summary panel."""
    dialect_name = db.bind.dialect.name if db.bind is not None else ""
    patient = db.scalar(
        select(Patient).where(
            Patient.id == patient_id,
            Patient.deleted_at.is_(None),
            Patient.is_active == True,  # noqa: E712
        )
    )
    if not patient:
        return None

    # Assigned doctors
    assignments = db.scalars(
        select(DoctorPatientAssignment)
        .options(joinedload(DoctorPatientAssignment.doctor))
        .where(DoctorPatientAssignment.patient_id == patient_id)
    ).unique().all()

    related_rows = []
    related_rows.extend(
        _fetch_summary_section(
            db,
            section="active_encounter",
            sort_key=Encounter.admitted_at,
            payload=_jsonb_payload(
                dialect_name=dialect_name,
                id=Encounter.id,
                encounter_type=Encounter.encounter_type,
                status=Encounter.status,
                admitted_at=Encounter.admitted_at,
                ward=Encounter.ward,
                bed_number=Encounter.bed_number,
                chief_complaint=Encounter.chief_complaint,
            ),
            where_clause=and_(
                Encounter.patient_id == patient_id,
                Encounter.status == EncounterStatus.active,
            ),
        )
    )
    related_rows.extend(
        _fetch_summary_section(
            db,
            section="active_medications",
            sort_key=Medication.created_at,
            payload=_jsonb_payload(
                dialect_name=dialect_name,
                id=Medication.id,
                name=Medication.name,
                dosage=Medication.dosage,
                frequency=Medication.frequency,
                route=Medication.route,
                status=Medication.status,
            ),
            where_clause=and_(
                Medication.patient_id == patient_id,
                Medication.status == OrderStatus.active,
            ),
        )
    )
    related_rows.extend(
        _fetch_summary_section(
            db,
            section="pending_labs",
            sort_key=Lab.ordered_at,
            payload=_jsonb_payload(
                dialect_name=dialect_name,
                id=Lab.id,
                test_name=Lab.test_name,
                category=Lab.category,
                status=Lab.status,
                ordered_at=Lab.ordered_at,
            ),
            where_clause=and_(
                Lab.patient_id == patient_id,
                Lab.status.in_([OrderStatus.pending, OrderStatus.active]),
            ),
        )
    )
    related_rows.extend(
        _fetch_summary_section(
            db,
            section="active_alerts",
            sort_key=Alert.created_at,
            payload=_jsonb_payload(
                dialect_name=dialect_name,
                id=Alert.id,
                severity=Alert.severity,
                category=Alert.category,
                title=Alert.title,
                message=Alert.message,
                created_at=Alert.created_at,
            ),
            where_clause=and_(
                Alert.patient_id == patient_id,
                Alert.is_acknowledged == False,  # noqa: E712
            ),
        )
    )
    related_rows.extend(
        _fetch_summary_section(
            db,
            section="current_conditions",
            sort_key=CurrentCondition.created_at,
            payload=_jsonb_payload(
                dialect_name=dialect_name,
                id=CurrentCondition.id,
                condition=CurrentCondition.condition,
                severity=CurrentCondition.severity,
            ),
            where_clause=and_(
                CurrentCondition.patient_id == patient_id,
                CurrentCondition.is_active == True,  # noqa: E712
            ),
        )
    )
    related_rows.extend(
        _fetch_summary_section(
            db,
            section="active_treatments",
            sort_key=Treatment.created_at,
            payload=_jsonb_payload(
                dialect_name=dialect_name,
                id=Treatment.id,
                name=Treatment.name,
                is_active=Treatment.is_active,
            ),
            where_clause=and_(
                Treatment.patient_id == patient_id,
                Treatment.is_active == True,  # noqa: E712
            ),
        )
    )

    sections: dict[str, list[tuple[object, dict]]] = {
        "active_encounter": [],
        "active_medications": [],
        "pending_labs": [],
        "active_alerts": [],
        "current_conditions": [],
        "active_treatments": [],
    }
    for row in related_rows:
        payload = row.payload
        if isinstance(payload, str):
            # PostgreSQL drivers normally decode JSONB for us, but keep a safe fallback.
            payload = json.loads(payload)
        sections[row.section].append((row.sort_key, payload))

    for section_rows in sections.values():
        section_rows.sort(key=lambda item: item[0], reverse=True)

    return {
        "patient": patient,
        "active_encounter": sections["active_encounter"][0][1] if sections["active_encounter"] else None,
        "active_medications": [payload for _, payload in sections["active_medications"]],
        "pending_labs": [payload for _, payload in sections["pending_labs"]],
        "active_alerts": [payload for _, payload in sections["active_alerts"]],
        "current_conditions": [payload for _, payload in sections["current_conditions"]],
        "active_treatments": [payload for _, payload in sections["active_treatments"]],
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
