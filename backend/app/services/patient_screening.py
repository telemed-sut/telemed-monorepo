"""Service layer for daily heart-failure screening submitted by the patient
mobile app.

Functions:
    submit(...)       — create a new screening row for the authenticated patient
    list_for_patient(...) — paginated history (latest first)
    get_today(...)    — latest screening recorded today (UTC) for the patient
    get_trends(...)   — last N days collapsed to one point per day (latest wins)
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.models.patient_screening import PatientScreening
from app.schemas.patient_screening import PatientScreeningCreate
from app.services import patient_notification as patient_notification_service
from app.services.patient_events import publish_patient_event_sync

logger = logging.getLogger(__name__)


_SYMPTOM_FIELDS = (
    "symptom_more_tired",
    "symptom_cannot_lie_flat",
    "symptom_paroxysmal_nocturnal_dyspnea",
    "symptom_more_than_one_pillow",
)

_WARNING_FIELDS = (
    "warning_dyspnea_orthopnea",
    "warning_abnormal_vitals",
)


def _has_any_symptom(record: PatientScreening) -> bool:
    return any(getattr(record, name) for name in _SYMPTOM_FIELDS)


def _has_any_warning_sign(record: PatientScreening) -> bool:
    return any(getattr(record, name) for name in _WARNING_FIELDS)


def _serialize(record: PatientScreening) -> dict[str, Any]:
    return {
        "id": record.id,
        "patient_id": record.patient_id,
        "symptom_more_tired": record.symptom_more_tired,
        "symptom_cannot_lie_flat": record.symptom_cannot_lie_flat,
        "symptom_paroxysmal_nocturnal_dyspnea": record.symptom_paroxysmal_nocturnal_dyspnea,
        "symptom_more_than_one_pillow": record.symptom_more_than_one_pillow,
        "systolic_bp": record.systolic_bp,
        "diastolic_bp": record.diastolic_bp,
        "heart_rate": record.heart_rate,
        "oxygen_saturation": record.oxygen_saturation,
        "weight_kg": record.weight_kg,
        "warning_dyspnea_orthopnea": record.warning_dyspnea_orthopnea,
        "warning_abnormal_vitals": record.warning_abnormal_vitals,
        "notes": record.notes,
        "recorded_at": record.recorded_at,
        "created_at": record.created_at,
        "has_any_symptom": _has_any_symptom(record),
        "has_any_warning_sign": _has_any_warning_sign(record),
    }


def _trend_point(record: PatientScreening) -> dict[str, Any]:
    return {
        "date": record.recorded_at.date().isoformat(),
        "recorded_at": record.recorded_at.isoformat(),
        "heart_rate": record.heart_rate,
        "sys_pressure": record.systolic_bp,
        "dia_pressure": record.diastolic_bp,
        "weight_kg": record.weight_kg,
    }


_SYMPTOM_LABELS_TH = {
    "symptom_more_tired": "เหนื่อยมากขึ้น",
    "symptom_cannot_lie_flat": "นอนราบไม่ได้",
    "symptom_paroxysmal_nocturnal_dyspnea": "ต้องลุกขึ้นมาหอบเหนื่อยหลังนอนหลับ",
    "symptom_more_than_one_pillow": "นอนหนุนหมอนมากกว่า 1 ใบ",
}

_WARNING_LABELS_TH = {
    "warning_dyspnea_orthopnea": "เหนื่อยจนนอนราบไม่ได้",
    "warning_abnormal_vitals": "สัญญาณชีพผิดปกติ",
}


def _maybe_notify_screening(*, db: Session, patient_id: UUID, record: PatientScreening) -> None:
    """If the submitted screening is concerning enough, push a real-time
    notification to the patient via `patient_notification_service.create_for_patient`.

    Heuristics:
        - any warning sign     → category=critical (suggest seeing a doctor)
        - 3+ symptoms          → category=warning  (encourage close monitoring)
        - 1-2 symptoms only    → no notification (reduces noise; the patient
                                  themselves checked the boxes a moment ago)
    """
    symptoms_present = [
        label for field, label in _SYMPTOM_LABELS_TH.items() if getattr(record, field)
    ]
    warnings_present = [
        label for field, label in _WARNING_LABELS_TH.items() if getattr(record, field)
    ]

    if warnings_present:
        category = "critical"
        title = "พบอาการเตือน — ควรพบแพทย์"
        body_parts = warnings_present + symptoms_present
    elif len(symptoms_present) >= 3:
        category = "warning"
        title = "บันทึกอาการผิดปกติหลายข้อ"
        body_parts = symptoms_present
    else:
        return

    message = " · ".join(body_parts) if body_parts else "บันทึกการตรวจคัดกรองวันนี้"
    try:
        patient_notification_service.create_for_patient(
            db=db,
            patient_id=patient_id,
            title=title,
            message=message,
            category=category,
            data={"screening_id": str(record.id)},
        )
    except Exception:
        logger.warning(
            "Failed to publish screening-derived patient notification",
            extra={"patient_id": str(patient_id), "screening_id": str(record.id)},
            exc_info=True,
        )


def submit(
    *,
    db: Session,
    patient_id: UUID,
    payload: PatientScreeningCreate,
) -> dict[str, Any]:
    """Create a new screening row. recorded_at is always server-generated.

    Side effect: if the screening is abnormal (warning signs or 3+ symptoms),
    a real-time `PatientNotification` is created and fanned out via SSE.
    """
    record = PatientScreening(
        patient_id=patient_id,
        symptom_more_tired=payload.symptom_more_tired,
        symptom_cannot_lie_flat=payload.symptom_cannot_lie_flat,
        symptom_paroxysmal_nocturnal_dyspnea=payload.symptom_paroxysmal_nocturnal_dyspnea,
        symptom_more_than_one_pillow=payload.symptom_more_than_one_pillow,
        systolic_bp=payload.systolic_bp,
        diastolic_bp=payload.diastolic_bp,
        heart_rate=payload.heart_rate,
        oxygen_saturation=payload.oxygen_saturation,
        weight_kg=payload.weight_kg,
        warning_dyspnea_orthopnea=payload.warning_dyspnea_orthopnea,
        warning_abnormal_vitals=payload.warning_abnormal_vitals,
        notes=payload.notes,
        recorded_at=datetime.now(timezone.utc),
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    publish_patient_event_sync(
        patient_id=patient_id,
        event_type="new_patient_screening",
        recorded_at=record.recorded_at,
        data={
            "screening_id": str(record.id),
            "trend_point": _trend_point(record),
        },
    )

    _maybe_notify_screening(db=db, patient_id=patient_id, record=record)

    return _serialize(record)


def list_for_patient(
    *,
    db: Session,
    patient_id: UUID,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    safe_limit = max(1, min(int(limit or 50), 200))
    safe_offset = max(0, int(offset or 0))

    rows = list(
        db.scalars(
            select(PatientScreening)
            .where(PatientScreening.patient_id == patient_id)
            .order_by(PatientScreening.recorded_at.desc())
            .limit(safe_limit)
            .offset(safe_offset)
        ).all()
    )
    total = (
        db.scalar(
            select(func.count(PatientScreening.id)).where(
                PatientScreening.patient_id == patient_id
            )
        )
        or 0
    )

    return {
        "items": [_serialize(r) for r in rows],
        "total": int(total),
    }


def get_today(*, db: Session, patient_id: UUID) -> dict[str, Any] | None:
    """Latest screening with recorded_at falling within the current UTC day."""
    now = datetime.now(timezone.utc)
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_day = start_of_day + timedelta(days=1)

    record = db.scalar(
        select(PatientScreening)
        .where(
            and_(
                PatientScreening.patient_id == patient_id,
                PatientScreening.recorded_at >= start_of_day,
                PatientScreening.recorded_at < end_of_day,
            )
        )
        .order_by(PatientScreening.recorded_at.desc())
        .limit(1)
    )
    if record is None:
        return None
    return _serialize(record)


def get_trends(
    *,
    db: Session,
    patient_id: UUID,
    days: int = 30,
) -> dict[str, Any]:
    """Last `days` days, collapsed to one point per day (latest record wins).

    Days with no screening submission are omitted (the mobile UI may render
    them as gaps). The response is sorted ascending by date so charts render
    left-to-right naturally.
    """
    safe_days = max(1, min(int(days or 30), 365))
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=safe_days)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )

    rows = list(
        db.scalars(
            select(PatientScreening)
            .where(
                and_(
                    PatientScreening.patient_id == patient_id,
                    PatientScreening.recorded_at >= start,
                )
            )
            .order_by(PatientScreening.recorded_at.asc())
        ).all()
    )

    by_day: dict[date, PatientScreening] = {}
    for row in rows:
        # Latest wins because rows are asc-sorted.
        by_day[row.recorded_at.astimezone(timezone.utc).date()] = row

    points = []
    for day in sorted(by_day.keys()):
        record = by_day[day]
        points.append(
            {
                "date": day,
                "systolic_bp": record.systolic_bp,
                "diastolic_bp": record.diastolic_bp,
                "heart_rate": record.heart_rate,
                "oxygen_saturation": record.oxygen_saturation,
                "weight_kg": record.weight_kg,
                "has_any_symptom": _has_any_symptom(record),
                "has_any_warning_sign": _has_any_warning_sign(record),
            }
        )

    return {"days": safe_days, "points": points}
