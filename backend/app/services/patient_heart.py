"""Aggregation service for the patient mobile-app heart/cardiology screens.

Sources:
    - PressureRecord       → latest vitals + history time-series
    - Patient              → patient_name, primary_diagnosis, risk_score
    - CurrentCondition     → diagnosis fallback (most recent active condition)
    - Medication           → active prescriptions list
    - PatientVitalThreshold → derive risk_level when risk_score is unset
    - Alert                → cardiac alerts (vital_sign category)

Risk-level derivation (when `Patient.risk_score` is not set):
    - any threshold breach on the latest BP/HR    → "high"
    - within 10% of an upper/lower threshold       → "medium"
    - otherwise                                    → "low"
    - if no thresholds and no readings             → None
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Iterable
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.models.alert import Alert
from app.models.current_condition import CurrentCondition
from app.models.enums import AlertCategory, AlertSeverity, OrderStatus
from app.models.medication import Medication
from app.models.patient import Patient
from app.models.patient_vital_threshold import PatientVitalThreshold
from app.models.pressure_record import PressureRecord


_RECENT_ALERT_WINDOW_DAYS = 7


def _patient_display_name(patient: Patient) -> str:
    if patient.name and patient.name.strip():
        return patient.name.strip()
    parts = [
        (patient.first_name or "").strip(),
        (patient.last_name or "").strip(),
    ]
    return " ".join(p for p in parts if p) or ""


def _format_blood_pressure(record: PressureRecord | None) -> str | None:
    if record is None:
        return None
    if record.sys_rate is None or record.dia_rate is None:
        return None
    return f"{record.sys_rate}/{record.dia_rate}"


def _resolve_diagnosis(*, db: Session, patient: Patient) -> str | None:
    if patient.primary_diagnosis and patient.primary_diagnosis.strip():
        return patient.primary_diagnosis.strip()

    condition = db.scalar(
        select(CurrentCondition)
        .where(
            and_(
                CurrentCondition.patient_id == patient.id,
                CurrentCondition.is_active.is_(True),
            )
        )
        .order_by(CurrentCondition.created_at.desc())
        .limit(1)
    )
    if condition and condition.condition:
        return condition.condition.strip() or None
    return None


def _risk_from_score(score: int | None) -> str | None:
    if score is None:
        return None
    if score >= 70:
        return "high"
    if score >= 30:
        return "medium"
    if score > 0:
        return "low"
    return None


def _risk_from_latest_reading(
    *,
    latest: PressureRecord | None,
    threshold: PatientVitalThreshold | None,
) -> str | None:
    if latest is None or threshold is None:
        return None

    breach = False
    near_breach = False

    def _check(value: int | None, lo: int | None, hi: int | None) -> None:
        nonlocal breach, near_breach
        if value is None:
            return
        if lo is not None and value < lo:
            breach = True
            return
        if hi is not None and value > hi:
            breach = True
            return
        if hi is not None and value >= hi - max(int(hi * 0.1), 1):
            near_breach = True
        if lo is not None and value <= lo + max(int(lo * 0.1), 1):
            near_breach = True

    _check(latest.heart_rate, threshold.min_heart_rate, threshold.max_heart_rate)
    _check(latest.sys_rate, threshold.min_sys_pressure, threshold.max_sys_pressure)
    _check(latest.dia_rate, threshold.min_dia_pressure, threshold.max_dia_pressure)

    if breach:
        return "high"
    if near_breach:
        return "medium"
    return "low"


def _resolve_risk_level(
    *,
    patient: Patient,
    latest: PressureRecord | None,
    threshold: PatientVitalThreshold | None,
) -> str | None:
    score_based = _risk_from_score(patient.risk_score)
    if score_based:
        return score_based
    return _risk_from_latest_reading(latest=latest, threshold=threshold)


def _serialize_history(records: Iterable[PressureRecord]) -> list[dict[str, Any]]:
    return [
        {
            "id": str(record.id),
            "heart_rate": record.heart_rate,
            "systolic_bp": record.sys_rate,
            "diastolic_bp": record.dia_rate,
            "measured_at": record.measured_at,
        }
        for record in records
    ]


def get_profile(
    *,
    db: Session,
    patient: Patient,
    history_limit: int = 30,
) -> dict[str, Any]:
    safe_limit = max(1, min(int(history_limit or 30), 200))

    history_records = list(
        db.scalars(
            select(PressureRecord)
            .where(PressureRecord.patient_id == patient.id)
            .order_by(PressureRecord.measured_at.desc())
            .limit(safe_limit)
        ).all()
    )
    latest = history_records[0] if history_records else None

    threshold = db.scalar(
        select(PatientVitalThreshold).where(
            PatientVitalThreshold.patient_id == patient.id
        )
    )

    medications = list(
        db.scalars(
            select(Medication.name)
            .where(
                and_(
                    Medication.patient_id == patient.id,
                    Medication.status == OrderStatus.active,
                )
            )
            .order_by(Medication.created_at.desc())
        ).all()
    )

    return {
        "patient_name": _patient_display_name(patient),
        "risk_level": _resolve_risk_level(
            patient=patient, latest=latest, threshold=threshold
        ),
        "diagnosis": _resolve_diagnosis(db=db, patient=patient),
        "latest_heart_rate": latest.heart_rate if latest else None,
        "latest_blood_pressure": _format_blood_pressure(latest),
        "last_checkup_at": latest.measured_at if latest else None,
        "medications": [name for name in medications if name],
        "history": _serialize_history(history_records),
    }


_SEVERITY_TO_MOBILE = {
    AlertSeverity.critical: "critical",
    AlertSeverity.warning: "urgent",
    AlertSeverity.info: "moderate",
}


def _serialize_alert(alert: Alert) -> dict[str, Any]:
    severity = _SEVERITY_TO_MOBILE.get(alert.severity, "normal")
    return {
        "id": alert.id,
        "severity": severity,
        "title": alert.title or "",
        "message": alert.message or "",
        "is_read": bool(alert.is_acknowledged),
        "occurred_at": alert.created_at,
    }


def list_alerts(
    *,
    db: Session,
    patient_id: UUID,
    unread_only: bool = False,
) -> dict[str, Any]:
    """Return cardiac (vital_sign) alerts for the patient, split into recent/history.

    Recent = created within the last `_RECENT_ALERT_WINDOW_DAYS`.
    History = older than that.
    """
    conditions = [
        Alert.patient_id == patient_id,
        Alert.category == AlertCategory.vital_sign,
    ]
    if unread_only:
        conditions.append(Alert.is_acknowledged.is_(False))

    alerts = list(
        db.scalars(
            select(Alert)
            .where(and_(*conditions))
            .order_by(Alert.created_at.desc())
        ).all()
    )

    cutoff = datetime.now(timezone.utc) - timedelta(days=_RECENT_ALERT_WINDOW_DAYS)
    recent: list[dict[str, Any]] = []
    history: list[dict[str, Any]] = []
    for alert in alerts:
        bucket = recent if (alert.created_at and alert.created_at >= cutoff) else history
        bucket.append(_serialize_alert(alert))

    return {"recent": recent, "history": history}
