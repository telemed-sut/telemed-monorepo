import logging
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session
from sqlalchemy import select

from app.models.patient_vital_threshold import PatientVitalThreshold
from app.models.alert import Alert
from app.models.enums import AlertSeverity, AlertCategory

logger = logging.getLogger(__name__)


def check_vitals_and_alert(
    db: Session,
    patient_id: UUID,
    heart_rate: int | None = None,
    sys_pressure: int | None = None,
    dia_pressure: int | None = None,
    weight_kg: float | None = None,
) -> None:
    """
    Checks the newly recorded vitals against the patient's thresholds.
    If any values are out of bounds, generates an Alert.
    """
    threshold = db.scalar(
        select(PatientVitalThreshold).where(PatientVitalThreshold.patient_id == patient_id)
    )
    if not threshold:
        return

    alerts = []

    # Check heart rate
    if heart_rate is not None:
        if threshold.max_heart_rate is not None and heart_rate > threshold.max_heart_rate:
            alerts.append(f"Heart rate is too high: {heart_rate} bpm (Max: {threshold.max_heart_rate})")
        if threshold.min_heart_rate is not None and heart_rate < threshold.min_heart_rate:
            alerts.append(f"Heart rate is too low: {heart_rate} bpm (Min: {threshold.min_heart_rate})")

    # Check blood pressure
    if sys_pressure is not None:
        if threshold.max_sys_pressure is not None and sys_pressure > threshold.max_sys_pressure:
            alerts.append(f"Systolic pressure is too high: {sys_pressure} mmHg (Max: {threshold.max_sys_pressure})")
        if threshold.min_sys_pressure is not None and sys_pressure < threshold.min_sys_pressure:
            alerts.append(f"Systolic pressure is too low: {sys_pressure} mmHg (Min: {threshold.min_sys_pressure})")

    if dia_pressure is not None:
        if threshold.max_dia_pressure is not None and dia_pressure > threshold.max_dia_pressure:
            alerts.append(f"Diastolic pressure is too high: {dia_pressure} mmHg (Max: {threshold.max_dia_pressure})")
        if threshold.min_dia_pressure is not None and dia_pressure < threshold.min_dia_pressure:
            alerts.append(f"Diastolic pressure is too low: {dia_pressure} mmHg (Min: {threshold.min_dia_pressure})")

    # Check weight
    if weight_kg is not None:
        if threshold.max_weight_kg is not None and weight_kg > threshold.max_weight_kg:
            alerts.append(f"Weight is too high: {weight_kg} kg (Max: {threshold.max_weight_kg})")
        if threshold.min_weight_kg is not None and weight_kg < threshold.min_weight_kg:
            alerts.append(f"Weight is too low: {weight_kg} kg (Min: {threshold.min_weight_kg})")

    if alerts:
        # Create an alert
        alert = Alert(
            patient_id=patient_id,
            severity=AlertSeverity.warning,  # Or logic to determine severity based on distance from threshold
            category=AlertCategory.vital_sign,
            title="Abnormal Vital Signs Detected",
            message=" | ".join(alerts),
        )
        db.add(alert)
        db.commit()

        # Real-time push to the patient's mobile app: create a PatientNotification
        # which fans out via Redis pub/sub to /patient-app/me/stream listeners.
        # Local import avoids any future circular dependency risk.
        try:
            from app.services import patient_notification as patient_notification_service

            patient_notification_service.create_for_patient(
                db=db,
                patient_id=patient_id,
                title="พบสัญญาณชีพผิดปกติ",
                message=" | ".join(alerts),
                category="warning",
                data={"alert_id": str(alert.id), "source": "vital_threshold"},
            )
        except Exception:
            logger.warning(
                "Failed to publish patient notification for vitals alert",
                extra={"patient_id": str(patient_id), "alert_id": str(alert.id)},
                exc_info=True,
            )
