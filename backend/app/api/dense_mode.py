from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.limiter import limiter
from app.models.enums import OrderStatus
from app.models.lab import Lab
from app.models.medication import Medication
from app.models.user import User
from app.schemas.dense_mode import PatientDenseSummary
from app.schemas.order import NoteCreate, OrderCreate
from app.schemas.timeline import TimelineListResponse
from app.services import audit as audit_service
from app.services import dense_mode as dense_mode_service
from app.services import order as order_service
from app.services import timeline as timeline_service
from app.services.auth import (
    get_clinical_user,
    get_db,
    verify_patient_access,
    verify_patient_access_doctor,
    verify_patient_access_doctor_or_nurse,
)

router = APIRouter(prefix="/patients", tags=["dense-mode"])
settings = get_settings()


@router.get("/{patient_id}/summary", response_model=PatientDenseSummary)
@limiter.limit("60/minute")
def get_patient_summary(
    request: Request,
    patient_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(verify_patient_access),
):
    """Dense mode: full patient summary for the 3-panel view."""
    result = dense_mode_service.get_patient_summary(db, patient_id)
    if not result:
        raise HTTPException(status_code=404, detail="Patient not found")

    audit_service.log_action(
        db,
        current_user.id,
        "view_patient_summary",
        resource_type="patient",
        resource_id=patient_id,
        ip_address=request.client.host if request.client else None,
    )
    return result


@router.get("/{patient_id}/timeline", response_model=TimelineListResponse)
@limiter.limit("60/minute")
def get_patient_timeline(
    request: Request,
    patient_id: UUID,
    cursor: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(verify_patient_access),
):
    """Dense mode: paginated clinical timeline."""
    audit_service.log_action(
        db,
        current_user.id,
        "view_patient_timeline",
        resource_type="patient",
        resource_id=patient_id,
        ip_address=request.client.host if request.client else None,
    )
    return timeline_service.get_patient_timeline(db, patient_id, cursor, limit)


@router.get("/{patient_id}/active-orders")
@limiter.limit("60/minute")
def get_active_orders(
    request: Request,
    patient_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(verify_patient_access),
):
    """Get active medication and pending lab orders."""
    meds = db.scalars(
        select(Medication)
        .where(and_(Medication.patient_id == patient_id, Medication.status == OrderStatus.active))
        .order_by(Medication.created_at.desc())
    ).all()

    labs = db.scalars(
        select(Lab)
        .where(and_(Lab.patient_id == patient_id, Lab.status.in_([OrderStatus.pending, OrderStatus.active])))
        .order_by(Lab.ordered_at.desc())
    ).all()

    audit_service.log_action(
        db,
        current_user.id,
        "view_active_orders",
        resource_type="patient",
        resource_id=patient_id,
        ip_address=request.client.host if request.client else None,
    )

    return {"medications": list(meds), "labs": list(labs)}


@router.get("/{patient_id}/results/trends")
@limiter.limit("60/minute")
def get_lab_trends(
    request: Request,
    patient_id: UUID,
    test_name: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(verify_patient_access),
):
    """Lab result trends for charting."""
    stmt = select(Lab).where(
        and_(
            Lab.patient_id == patient_id,
            Lab.status == OrderStatus.completed,
            Lab.result_value.isnot(None),
        )
    )
    if test_name:
        stmt = stmt.where(Lab.test_name.ilike(f"%{test_name}%"))
    stmt = stmt.order_by(Lab.resulted_at.asc())

    results = db.scalars(stmt).all()

    audit_service.log_action(
        db,
        current_user.id,
        "view_lab_trends",
        resource_type="patient",
        resource_id=patient_id,
        ip_address=request.client.host if request.client else None,
    )

    return {
        "results": [
            {
                "id": str(r.id),
                "test_name": r.test_name,
                "result_value": r.result_value,
                "result_unit": r.result_unit,
                "reference_range": r.reference_range,
                "is_abnormal": r.is_abnormal,
                "resulted_at": r.resulted_at.isoformat() if r.resulted_at else None,
            }
            for r in results
        ]
    }


@router.post("/{patient_id}/orders", status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_order(
    request: Request,
    patient_id: UUID,
    payload: OrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(verify_patient_access_doctor),
):
    """Create a medication, lab, or imaging order (doctors only, must be assigned)."""
    record = order_service.create_order(db, patient_id, payload, current_user.id)
    audit_service.log_action(
        db,
        current_user.id,
        f"create_{payload.order_type.value}_order",
        resource_type=payload.order_type.value,
        resource_id=record.id,
        ip_address=request.client.host if request.client else None,
    )
    return record


@router.post("/{patient_id}/notes", status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_note(
    request: Request,
    patient_id: UUID,
    payload: NoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(verify_patient_access_doctor_or_nurse),
):
    """Create a SOAP/progress note (doctor/nurse, must be assigned)."""
    event = order_service.create_progress_note(db, patient_id, payload, current_user.id)
    audit_service.log_action(
        db,
        current_user.id,
        "create_note",
        resource_type="note",
        resource_id=event.id,
        ip_address=request.client.host if request.client else None,
    )
    return event


@router.post("/{patient_id}/break-glass", status_code=status.HTTP_200_OK)
@limiter.limit("10/minute")
def break_glass_access(
    request: Request,
    patient_id: UUID,
    reason: str | None = Body(default=None, embed=True),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_clinical_user),
):
    """Emergency access to unassigned patient with mandatory reason logging.

    Creates a time-limited access session (8 hours) by logging a break-glass
    audit entry. Subsequent requests to this patient's endpoints will check
    for this entry and grant access.
    """
    if not settings.enable_break_glass_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Break-glass access is disabled by policy in this phase.",
        )

    normalized_reason = (reason or "").strip()
    if len(normalized_reason) < 5:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Reason must be at least 5 characters.",
        )

    # Verify the patient exists before creating an audit record
    result = dense_mode_service.get_patient_summary(db, patient_id)
    if not result:
        raise HTTPException(status_code=404, detail="Patient not found")

    audit_service.log_action(
        db,
        current_user.id,
        "break_glass",
        resource_type="patient",
        resource_id=patient_id,
        ip_address=request.client.host if request.client else None,
        is_break_glass=True,
        break_glass_reason=normalized_reason,
    )
    return result
