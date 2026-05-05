from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.doctor_patient_assignment import DoctorPatientAssignment
from app.models.enums import UserRole
from app.models.patient import Patient
from app.models.patient_screening import PatientScreening
from app.models.pressure_record import PressureRecord
from app.models.user import User
from app.models.weight_record import WeightRecord
from app.schemas.trend import (
    PatientVitalsTrendResponse,
    VitalTrendDataPoint,
)


def get_patient_vitals_trends(
    db: Session,
    patient_id: UUID,
    days: int = 30,
) -> PatientVitalsTrendResponse:
    cutoff_at = datetime.now(timezone.utc) - timedelta(days=days)

    # 1. Fetch Pressure/Heart Rate Records
    pressure_records = db.scalars(
        select(PressureRecord)
        .where(
            PressureRecord.patient_id == patient_id,
            PressureRecord.measured_at >= cutoff_at,
        )
        .order_by(PressureRecord.measured_at.asc())
    ).all()

    # 2. Fetch Weight Records
    weight_records = db.scalars(
        select(WeightRecord)
        .where(
            WeightRecord.patient_id == patient_id,
            WeightRecord.measured_at >= cutoff_at,
        )
        .order_by(WeightRecord.measured_at.asc())
    ).all()

    # 3. Fetch patient-app screening vitals. These are self-reported from the
    # mobile app and should appear in the clinician trend view even when they
    # were not entered through the staff weight-record or device-pressure paths.
    screening_records = db.scalars(
        select(PatientScreening)
        .where(
            PatientScreening.patient_id == patient_id,
            PatientScreening.recorded_at >= cutoff_at,
        )
        .order_by(PatientScreening.recorded_at.asc())
    ).all()

    # Group by date
    trends_by_date: dict[date, VitalTrendDataPoint] = {}
    field_timestamps: dict[tuple[date, str], datetime] = {}

    def ensure_point(record_date: date) -> VitalTrendDataPoint:
        if record_date not in trends_by_date:
            trends_by_date[record_date] = VitalTrendDataPoint(date=record_date)
        return trends_by_date[record_date]

    def track_recorded_at(point: VitalTrendDataPoint, measured_at: datetime) -> None:
        if point.recorded_at is None or point.recorded_at < measured_at:
            point.recorded_at = measured_at

    def should_update(record_date: date, field_name: str, measured_at: datetime) -> bool:
        key = (record_date, field_name)
        previous = field_timestamps.get(key)
        if previous is not None and previous > measured_at:
            return False
        field_timestamps[key] = measured_at
        return True

    # Process Pressure
    for pr in pressure_records:
        record_date = pr.measured_at.date()
        point = ensure_point(record_date)
        track_recorded_at(point, pr.measured_at)

        # If multiple records per day, keep the latest value per field.
        if should_update(record_date, "heart_rate", pr.measured_at):
            point.heart_rate = pr.heart_rate
        if should_update(record_date, "sys_pressure", pr.measured_at):
            point.sys_pressure = pr.sys_rate
        if should_update(record_date, "dia_pressure", pr.measured_at):
            point.dia_pressure = pr.dia_rate

    # Process Weight
    for wr in weight_records:
        record_date = wr.measured_at.date()
        point = ensure_point(record_date)
        track_recorded_at(point, wr.measured_at)

        if should_update(record_date, "weight_kg", wr.measured_at):
            point.weight_kg = wr.weight_kg
            point.height_cm = wr.height_cm
            point.bmi = wr.bmi

    # Process mobile screening vitals. Height and BMI are intentionally left
    # untouched because screening submissions do not carry height.
    for screening in screening_records:
        record_date = screening.recorded_at.date()
        point = ensure_point(record_date)
        track_recorded_at(point, screening.recorded_at)

        if screening.heart_rate is not None and should_update(
            record_date, "heart_rate", screening.recorded_at
        ):
            point.heart_rate = screening.heart_rate
        if screening.systolic_bp is not None and should_update(
            record_date, "sys_pressure", screening.recorded_at
        ):
            point.sys_pressure = screening.systolic_bp
        if screening.diastolic_bp is not None and should_update(
            record_date, "dia_pressure", screening.recorded_at
        ):
            point.dia_pressure = screening.diastolic_bp
        if screening.weight_kg is not None and should_update(
            record_date, "weight_kg", screening.recorded_at
        ):
            point.weight_kg = screening.weight_kg

    # Sort the final list by date
    sorted_dates = sorted(trends_by_date.keys())
    trends_list = [trends_by_date[d] for d in sorted_dates]

    return PatientVitalsTrendResponse(
        patient_id=str(patient_id),
        trends=trends_list
    )


def _accessible_patients_query(current_user: User):
    stmt = select(Patient).where(
        Patient.deleted_at.is_(None),
        Patient.is_active == True,  # noqa: E712
    )

    if current_user.role == UserRole.admin:
        return stmt

    if current_user.role in (UserRole.doctor, UserRole.medical_student):
        return (
            stmt.join(
                DoctorPatientAssignment,
                DoctorPatientAssignment.patient_id == Patient.id,
            )
            .where(DoctorPatientAssignment.doctor_id == current_user.id)
            .distinct()
        )

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Access denied. Required roles: ['admin', 'doctor', 'medical_student']",
    )
