from datetime import datetime, timedelta, timezone

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
from app.services import meeting as meeting_service

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

    - Admin: global data across all patients and meetings.
    - Doctor: scoped to own meetings + assigned patient meetings.
    """
    if current_user.role not in (UserRole.admin, UserRole.doctor):
        raise HTTPException(status_code=403, detail="Access denied")

    if year is None:
        year = datetime.now(timezone.utc).year

    resolved_year = int(year)
    doctor_id = current_user.id
    is_doctor = current_user.role == UserRole.doctor

    month_labels = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]
    now_utc = datetime.now(timezone.utc)
    today_start = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=today_start.weekday())
    month_start = today_start.replace(day=1)

    # New patients per month
    patients_stmt = (
        select(
            extract("month", Patient.created_at).label("m"),
            func.count(func.distinct(Patient.id)).label("cnt"),
        )
        .where(
            extract("year", Patient.created_at) == resolved_year,
            Patient.deleted_at.is_(None),
            Patient.is_active == True,  # noqa: E712
        )
    )
    if is_doctor:
        patients_stmt = patients_stmt.join(
            DoctorPatientAssignment,
            DoctorPatientAssignment.patient_id == Patient.id,
        ).where(DoctorPatientAssignment.doctor_id == doctor_id)
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
        .where(extract("year", Meeting.date_time) == resolved_year)
    )
    if is_doctor:
        meetings_stmt = meetings_stmt.where(
            meeting_service.build_doctor_visibility_clause(doctor_id)
        )
    meetings_stmt = meetings_stmt.group_by("m")

    meetings_by_month: dict[int, int] = {}
    # nosemgrep: generic-sql-fastapi
    # SQLAlchemy compiles this ORM statement with bound parameters; no raw SQL is built from request data here.
    for row in db.execute(meetings_stmt):  # nosemgrep: generic-sql-fastapi
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
        visibility_clause = meeting_service.build_doctor_visibility_clause(doctor_id)
        total_patients_stmt = (
            select(func.count(func.distinct(Patient.id)))
            .select_from(Patient)
            .join(DoctorPatientAssignment, DoctorPatientAssignment.patient_id == Patient.id)
            .where(
                DoctorPatientAssignment.doctor_id == doctor_id,
                Patient.deleted_at.is_(None),
                Patient.is_active == True,  # noqa: E712
            )
        )
        total_patients = db.scalar(total_patients_stmt) or 0
        # nosemgrep: generic-sql-fastapi
        # visibility_clause is a typed SQLAlchemy expression, so this remains a parameterized ORM query.
        total_meetings = db.scalar(
            select(func.count())  # nosemgrep: generic-sql-fastapi
            .select_from(Meeting)
            .where(visibility_clause)
        ) or 0
        # nosemgrep: generic-sql-fastapi
        # Date filters and visibility_clause are compiled by SQLAlchemy without string interpolation.
        today_consultations = db.scalar(
            select(func.count())  # nosemgrep: generic-sql-fastapi
            .select_from(Meeting)
            .where(
                visibility_clause,
                Meeting.date_time >= today_start,
                Meeting.date_time < today_start + timedelta(days=1),
            )
        ) or 0
        this_week_consultations = db.scalar(
            select(func.count())  # nosemgrep: generic-sql-fastapi
            .select_from(Meeting)
            .where(
                visibility_clause,
                Meeting.date_time >= week_start,
                Meeting.date_time < week_start + timedelta(days=7),
            )
        ) or 0
        this_month_new_patients = db.scalar(
            select(func.count(func.distinct(Patient.id)))
            .select_from(Patient)
            .join(DoctorPatientAssignment, DoctorPatientAssignment.patient_id == Patient.id)
            .where(
                DoctorPatientAssignment.doctor_id == doctor_id,
                Patient.deleted_at.is_(None),
                Patient.is_active == True,  # noqa: E712
                Patient.created_at >= month_start,
                Patient.created_at < today_start + timedelta(days=1),
            )
        ) or 0
    else:
        total_patients = db.scalar(
            select(func.count()).select_from(Patient).where(
                Patient.deleted_at.is_(None),
                Patient.is_active == True,  # noqa: E712
            )
        ) or 0
        total_meetings = db.scalar(select(func.count()).select_from(Meeting)) or 0
        today_consultations = db.scalar(
            select(func.count())
            .select_from(Meeting)
            .where(
                Meeting.date_time >= today_start,
                Meeting.date_time < today_start + timedelta(days=1),
            )
        ) or 0
        this_week_consultations = db.scalar(
            select(func.count())
            .select_from(Meeting)
            .where(
                Meeting.date_time >= week_start,
                Meeting.date_time < week_start + timedelta(days=7),
            )
        ) or 0
        this_month_new_patients = db.scalar(
            select(func.count())
            .select_from(Patient)
            .where(
                Patient.deleted_at.is_(None),
                Patient.is_active == True,  # noqa: E712
                Patient.created_at >= month_start,
                Patient.created_at < today_start + timedelta(days=1),
            )
        ) or 0

    return {
        "year": resolved_year,
        "monthly": monthly,
        "totals": {
            "patients": total_patients,
            "meetings": total_meetings,
        },
        "kpis": {
            "today_consultations": today_consultations,
            "this_week_consultations": this_week_consultations,
            "this_month_new_patients": this_month_new_patients,
        },
    }
