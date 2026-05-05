"""Aggregation service for the patient mobile-app medical-records screens.

Sources:
    PressureRecord       → latest BP/HR for the vitals header
    WeightRecord         → latest weight + height (for BMI), plus history
    Patient.blood_group  → blood type
    Patient.allergies    → free-text comma-separated list, parsed into entries
    CurrentCondition     → conditions list
    Medication           → medications list
    Encounter            → visits list
    Lab                  → labs list
    HeartSoundRecord     → heart sound history
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session, joinedload

from app.models.current_condition import CurrentCondition
from app.models.encounter import Encounter
from app.models.heart_sound_record import HeartSoundRecord
from app.models.lab import Lab
from app.models.medication import Medication
from app.models.patient import Patient
from app.models.pressure_record import PressureRecord
from app.models.user import User
from app.models.weight_record import WeightRecord


# ---------- Helpers ----------


def _format_blood_pressure(record: PressureRecord | None) -> str | None:
    if record is None or record.sys_rate is None or record.dia_rate is None:
        return None
    return f"{record.sys_rate}/{record.dia_rate}"


def _compute_bmi(weight_kg: float | None, height_cm: float | None) -> float | None:
    if not weight_kg or not height_cm or height_cm <= 0:
        return None
    height_m = height_cm / 100.0
    return round(weight_kg / (height_m * height_m), 1)


def _parse_allergies(text: str | None) -> list[dict[str, Any]]:
    """Patient.allergies is free-text. Split on common separators and return
    one entry per allergen with severity/reaction left null. The mobile app
    tolerates nulls in those fields.
    """
    if not text:
        return []

    raw_entries: list[str] = []
    for separator in ("\n", ";", ","):
        if separator in text:
            raw_entries = [piece.strip() for piece in text.split(separator)]
            break
    if not raw_entries:
        raw_entries = [text.strip()]

    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for entry in raw_entries:
        if not entry:
            continue
        key = entry.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append({"name": entry, "severity": None, "reaction": None})
    return result


def _serialize_doctor(user: User | None) -> dict[str, Any] | None:
    if user is None:
        return None
    return {
        "id": user.id,
        "first_name": getattr(user, "first_name", None),
        "last_name": getattr(user, "last_name", None),
        "email": getattr(user, "email", None),
    }


# ---------- Bundle endpoint ----------


def get_medical_records_bundle(
    *,
    db: Session,
    patient: Patient,
    weight_history_limit: int = 30,
) -> dict[str, Any]:
    safe_limit = max(1, min(int(weight_history_limit or 30), 200))

    # Latest pressure for BP/HR.
    latest_pressure = db.scalar(
        select(PressureRecord)
        .where(PressureRecord.patient_id == patient.id)
        .order_by(PressureRecord.measured_at.desc())
        .limit(1)
    )

    # Weight history (latest first).
    weight_records = list(
        db.scalars(
            select(WeightRecord)
            .where(WeightRecord.patient_id == patient.id)
            .order_by(WeightRecord.measured_at.desc())
            .limit(safe_limit)
        ).all()
    )
    latest_weight_record = weight_records[0] if weight_records else None

    latest_height = (
        latest_weight_record.height_cm if latest_weight_record else None
    )
    latest_weight = (
        latest_weight_record.weight_kg if latest_weight_record else None
    )
    last_measured_at = None
    if latest_weight_record and latest_pressure:
        last_measured_at = max(
            latest_weight_record.measured_at, latest_pressure.measured_at
        )
    elif latest_weight_record:
        last_measured_at = latest_weight_record.measured_at
    elif latest_pressure:
        last_measured_at = latest_pressure.measured_at

    vitals = {
        "height_cm": latest_height,
        "weight_kg": latest_weight,
        "blood_type": patient.blood_group,
        "bmi": _compute_bmi(latest_weight, latest_height),
        "latest_blood_pressure": _format_blood_pressure(latest_pressure),
        "latest_heart_rate": latest_pressure.heart_rate if latest_pressure else None,
        "last_measured_at": last_measured_at,
    }

    weight_history = [
        {
            "id": record.id,
            "weight_kg": record.weight_kg,
            "height_cm": record.height_cm,
            "measured_at": record.measured_at,
        }
        for record in weight_records
    ]

    conditions = list(
        db.scalars(
            select(CurrentCondition)
            .where(
                and_(
                    CurrentCondition.patient_id == patient.id,
                    CurrentCondition.is_active.is_(True),
                )
            )
            .order_by(CurrentCondition.created_at.desc())
        ).all()
    )
    condition_items = [
        {
            "id": c.id,
            "name": c.condition,
            "status": "active" if c.is_active else "resolved",
            "severity": c.severity,
            "diagnosed_at": c.onset_date or c.created_at,
            "notes": c.notes,
        }
        for c in conditions
    ]

    medications = list(
        db.scalars(
            select(Medication)
            .where(Medication.patient_id == patient.id)
            .order_by(Medication.created_at.desc())
        ).all()
    )
    medication_items = [
        {
            "id": m.id,
            "name": m.name,
            "dosage": m.dosage,
            "frequency": m.frequency,
            "route": m.route,
            "status": m.status.value if hasattr(m.status, "value") else str(m.status),
            "start_date": m.start_date,
            "end_date": m.end_date,
            "notes": m.notes,
        }
        for m in medications
    ]

    return {
        "vitals": vitals,
        "weight_history": weight_history,
        "conditions": condition_items,
        "medications": medication_items,
        "allergies": _parse_allergies(patient.allergies),
    }


# ---------- Visits ----------


def list_visits(
    *,
    db: Session,
    patient_id: UUID,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    safe_limit = max(1, min(int(limit or 50), 100))
    safe_offset = max(0, int(offset or 0))

    items = list(
        db.scalars(
            select(Encounter)
            .options(joinedload(Encounter.attending_doctor))
            .where(Encounter.patient_id == patient_id)
            .order_by(Encounter.admitted_at.desc())
            .limit(safe_limit)
            .offset(safe_offset)
        ).all()
    )
    total = (
        db.scalar(
            select(func.count(Encounter.id)).where(Encounter.patient_id == patient_id)
        )
        or 0
    )

    return {
        "items": [
            {
                "id": e.id,
                "encounter_type": (
                    e.encounter_type.value
                    if hasattr(e.encounter_type, "value")
                    else str(e.encounter_type)
                ),
                "status": (
                    e.status.value if hasattr(e.status, "value") else str(e.status)
                ),
                "admitted_at": e.admitted_at,
                "discharged_at": e.discharged_at,
                "ward": e.ward,
                "bed_number": e.bed_number,
                "chief_complaint": e.chief_complaint,
                "discharge_summary": e.discharge_summary,
                "doctor": _serialize_doctor(e.attending_doctor),
            }
            for e in items
        ],
        "total": int(total),
    }


# ---------- Labs ----------


def list_labs(
    *,
    db: Session,
    patient_id: UUID,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    safe_limit = max(1, min(int(limit or 50), 100))
    safe_offset = max(0, int(offset or 0))

    items = list(
        db.scalars(
            select(Lab)
            .options(joinedload(Lab.ordering_doctor))
            .where(Lab.patient_id == patient_id)
            .order_by(Lab.ordered_at.desc())
            .limit(safe_limit)
            .offset(safe_offset)
        ).all()
    )
    total = (
        db.scalar(
            select(func.count(Lab.id)).where(Lab.patient_id == patient_id)
        )
        or 0
    )

    return {
        "items": [
            {
                "id": lab.id,
                "test_name": lab.test_name,
                "category": lab.category,
                "status": (
                    lab.status.value if hasattr(lab.status, "value") else str(lab.status)
                ),
                "ordered_at": lab.ordered_at,
                "resulted_at": lab.resulted_at,
                "result_value": lab.result_value,
                "result_unit": lab.result_unit,
                "reference_range": lab.reference_range,
                "is_abnormal": bool(lab.is_abnormal),
                "notes": lab.notes,
                "doctor": _serialize_doctor(lab.ordering_doctor),
            }
            for lab in items
        ],
        "total": int(total),
    }


# ---------- Heart sound recordings ----------


def list_heart_sounds(
    *,
    db: Session,
    patient_id: UUID,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    safe_limit = max(1, min(int(limit or 50), 100))
    safe_offset = max(0, int(offset or 0))

    items = list(
        db.scalars(
            select(HeartSoundRecord)
            .where(HeartSoundRecord.patient_id == patient_id)
            .order_by(HeartSoundRecord.recorded_at.desc())
            .limit(safe_limit)
            .offset(safe_offset)
        ).all()
    )
    total = (
        db.scalar(
            select(func.count(HeartSoundRecord.id)).where(
                HeartSoundRecord.patient_id == patient_id
            )
        )
        or 0
    )

    return {
        "items": [
            {
                "id": record.id,
                "device_id": record.device_id,
                "position": record.position,
                "blob_url": record.blob_url,
                "duration_seconds": record.duration_seconds,
                "recorded_at": record.recorded_at,
                "created_at": record.created_at,
            }
            for record in items
        ],
        "total": int(total),
    }


# ---------- Profile ----------


def serialize_profile(patient: Patient) -> dict[str, Any]:
    return {
        "id": patient.id,
        "first_name": patient.first_name,
        "last_name": patient.last_name,
        "name": patient.name,
        "phone": patient.phone,
        "email": patient.email,
        "address": patient.address,
        "blood_group": patient.blood_group,
        "date_of_birth": patient.date_of_birth,
        "gender": patient.gender,
    }


def update_profile(
    *,
    db: Session,
    patient: Patient,
    first_name: str | None = None,
    last_name: str | None = None,
    email: str | None = None,
    address: str | None = None,
) -> dict[str, Any]:
    """Update editable profile fields. Phone and date_of_birth are intentionally
    excluded — phone is the login key, DOB is part of the medical record.
    """
    changed = False

    if first_name is not None:
        new_value = first_name.strip()
        if not new_value:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="first_name cannot be empty.",
            )
        if new_value != patient.first_name:
            patient.first_name = new_value
            changed = True

    if last_name is not None:
        new_value = last_name.strip()
        if not new_value:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="last_name cannot be empty.",
            )
        if new_value != patient.last_name:
            patient.last_name = new_value
            changed = True

    if email is not None:
        new_value = email.strip() or None
        if new_value != patient.email:
            patient.email = new_value
            changed = True

    if address is not None:
        new_value = address.strip() or None
        if new_value != patient.address:
            patient.address = new_value
            changed = True

    if changed:
        # Also refresh the cached display name.
        patient.name = f"{patient.first_name} {patient.last_name}".strip()
        db.add(patient)
        db.commit()
        db.refresh(patient)

    return serialize_profile(patient)
