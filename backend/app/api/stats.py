from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import extract, func, select
from sqlalchemy.orm import Session

from app.core.limiter import limiter
from app.models.doctor_patient_assignment import DoctorPatientAssignment
from app.models.enums import UserRole
from app.models.meeting import Meeting
from app.models.patient import Patient
from app.models.user import User
from app.services import auth as auth_service

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/overview")
@limiter.limit("200/minute")
def get_overview_stats(
    request: Request,
    year: int = Query(default=None, description="Year to aggregate (defaults to current year)"),
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    """Return monthly aggregated stats for the dashboard chart.

    - Admin/Staff: global data across all patients and meetings.
    - Doctor: scoped to assigned patients and own meetings only.
    """
    if current_user.role not in (UserRole.admin, UserRole.staff, UserRole.doctor):
        raise HTTPException(status_code=403, detail="Access denied")

    if year is None:
        year = datetime.now(timezone.utc).year

    is_doctor = current_user.role == UserRole.doctor

    month_labels = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]

    # New patients per month
    patients_stmt = (
        select(
            extract("month", Patient.created_at).label("m"),
            func.count(func.distinct(Patient.id)).label("cnt"),
        )
        .where(extract("year", Patient.created_at) == year)
    )
    if is_doctor:
        patients_stmt = patients_stmt.join(
            DoctorPatientAssignment,
            DoctorPatientAssignment.patient_id == Patient.id,
        ).where(DoctorPatientAssignment.doctor_id == current_user.id)
    patients_stmt = patients_stmt.group_by("m")

    patients_by_month: dict[int, int] = {}
    for row in db.execute(patients_stmt):
        patients_by_month[int(row.m)] = row.cnt

    # Meetings per month
    meetings_stmt = (
        select(
            extract("month", Meeting.date_time).label("m"),
            func.count().label("cnt"),
        )
        .where(extract("year", Meeting.date_time) == year)
    )
    if is_doctor:
        meetings_stmt = meetings_stmt.where(Meeting.doctor_id == current_user.id)
    meetings_stmt = meetings_stmt.group_by("m")

    meetings_by_month: dict[int, int] = {}
    for row in db.execute(meetings_stmt):
        meetings_by_month[int(row.m)] = row.cnt

    # Build response
    monthly = []
    for i in range(1, 13):
        monthly.append({
            "month": month_labels[i - 1],
            "new_patients": patients_by_month.get(i, 0),
            "consultations": meetings_by_month.get(i, 0),
        })

    # Totals — also scoped by role
    if is_doctor:
        total_patients_stmt = (
            select(func.count(func.distinct(Patient.id)))
            .select_from(Patient)
            .join(DoctorPatientAssignment, DoctorPatientAssignment.patient_id == Patient.id)
            .where(DoctorPatientAssignment.doctor_id == current_user.id)
        )
        total_patients = db.scalar(total_patients_stmt) or 0
        total_meetings = db.scalar(
            select(func.count()).select_from(Meeting).where(Meeting.doctor_id == current_user.id)
        ) or 0
    else:
        total_patients = db.scalar(select(func.count()).select_from(Patient)) or 0
        total_meetings = db.scalar(select(func.count()).select_from(Meeting)) or 0

    return {
        "year": year,
        "monthly": monthly,
        "totals": {
            "patients": total_patients,
            "meetings": total_meetings,
        },
    }
