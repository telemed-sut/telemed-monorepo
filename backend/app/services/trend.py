from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.alert import Alert
from app.models.doctor_patient_assignment import DoctorPatientAssignment
from app.models.enums import AlertCategory, UserRole
from app.models.patient import Patient
from app.models.patient_vital_threshold import PatientVitalThreshold
from app.models.pressure_record import PressureRecord
from app.models.user import User
from app.models.weight_record import WeightRecord
from app.schemas.trend import (
    PatientVitalsTrendResponse,
    VitalTrendDataPoint,
)
from app.services.pressure import pressure_service


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

    # Group by date
    trends_by_date: dict[date, VitalTrendDataPoint] = {}

    # Process Pressure
    for pr in pressure_records:
        record_date = pr.measured_at.date()
        if record_date not in trends_by_date:
            trends_by_date[record_date] = VitalTrendDataPoint(date=record_date)
        
        # If multiple records per day, we could average them, 
        # but for simplicity let's take the latest or max. Here we'll take the latest (due to asc sort, it overwrites).
        trends_by_date[record_date].heart_rate = pr.heart_rate
        trends_by_date[record_date].sys_pressure = pr.sys_rate
        trends_by_date[record_date].dia_pressure = pr.dia_rate

    # Process Weight
    for wr in weight_records:
        record_date = wr.measured_at.date()
        if record_date not in trends_by_date:
            trends_by_date[record_date] = VitalTrendDataPoint(date=record_date)
        
        trends_by_date[record_date].weight_kg = wr.weight_kg
        trends_by_date[record_date].height_cm = wr.height_cm
        trends_by_date[record_date].bmi = wr.bmi

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
