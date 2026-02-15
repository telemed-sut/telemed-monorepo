from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status, BackgroundTasks
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.patient import PatientCreate, PatientListResponse, PatientOut, PatientUpdate
from app.services import auth as auth_service
from app.services import patient as patient_service
from app.services import novu as novu_service

router = APIRouter(prefix="/patients", tags=["patients"])
settings = get_settings()
limiter = Limiter(key_func=get_remote_address)


def notify_staff(db: Session, current_user: User, background_tasks: BackgroundTasks, 
                 action: str, patient_name: str):
    """Send notification to all staff except the current user"""
    stmt = select(User.id).where(User.role.in_([UserRole.admin, UserRole.staff]))
    user_ids = [str(row[0]) for row in db.execute(stmt).fetchall() if str(row[0]) != str(current_user.id)]
    
    if not user_ids:
        return
    
    notify_fn = {
        "created": lambda: novu_service.notify_patient_created(user_ids, patient_name, current_user.email),
        "updated": lambda: novu_service.notify_patient_updated(user_ids, patient_name, current_user.email),
        "deleted": lambda: novu_service.notify_patient_deleted(user_ids, patient_name, current_user.email),
    }.get(action)
    
    if notify_fn:
        background_tasks.add_task(notify_fn)


@router.post("", response_model=PatientOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_patient(
    request: Request,
    payload: PatientCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    """Create new patient (admin, staff, or doctor)"""
    if current_user.role not in (UserRole.admin, UserRole.staff, UserRole.doctor):
        raise HTTPException(status_code=403, detail="Access denied")
    doctor_id = current_user.id if current_user.role == UserRole.doctor else None
    patient = patient_service.create_patient(db, payload, doctor_id=doctor_id)
    notify_staff(db, current_user, background_tasks, "created", f"{patient.first_name} {patient.last_name}")
    return patient


@router.get("", response_model=PatientListResponse)
@limiter.limit("60/minute")
def list_patients(
    request: Request,
    page: int = Query(default=settings.default_page, ge=1),
    limit: int = Query(default=settings.default_limit, ge=1),
    q: Optional[str] = Query(default=None, description="Search term"),
    sort: str = Query(default="created_at", pattern="^(created_at|updated_at|last_name|first_name)$"),
    order: str = Query(default="desc", pattern="^(asc|desc)$"),
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    """List patients with pagination.

    - Admin/Staff: can list all patients.
    - Doctor: can list only assigned patients.
    """
    doctor_id: Optional[UUID] = None
    
    if current_user.role == UserRole.doctor:
        doctor_id = current_user.id
    elif current_user.role in (UserRole.admin, UserRole.staff):
        # Admin and staff can see all patients
        pass
    else:
        # Others are forbidden
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Required roles: ['admin', 'staff', 'doctor']",
        )

    items, total = patient_service.list_patients(
        db,
        page,
        min(limit, settings.max_limit),
        q,
        sort,
        order,
        doctor_id=doctor_id,
    )
    return PatientListResponse(items=items, page=page, limit=min(limit, settings.max_limit), total=total)


@router.get("/{patient_id}", response_model=PatientOut)
@limiter.limit("60/minute")
def get_patient(
    request: Request,
    patient_id: str,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    """Get patient by ID.

    - Admin/Staff: can access all.
    - Doctor: only assigned or break-glass active.
    """
    if current_user.role not in (UserRole.admin, UserRole.staff, UserRole.doctor):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Required roles: ['admin', 'staff', 'doctor']",
        )

    patient = patient_service.get_patient(db, patient_id)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")

    if current_user.role == UserRole.doctor:
        try:
            patient_uuid = UUID(patient_id)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
        if not auth_service._has_active_assignment(db, current_user.id, patient_uuid) and not auth_service._has_active_break_glass(db, current_user.id, patient_uuid):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not assigned to this patient. Use break-glass for emergency access.",
            )

    return patient


@router.put("/{patient_id}", response_model=PatientOut)
@limiter.limit("30/minute")
def update_patient(
    request: Request,
    patient_id: str,
    payload: PatientUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    """Update patient (admin, staff, or doctor for assigned patients)"""
    if current_user.role not in (UserRole.admin, UserRole.staff, UserRole.doctor):
        raise HTTPException(status_code=403, detail="Access denied")

    patient = patient_service.get_patient(db, patient_id)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")

    # Doctors can only edit assigned patients
    if current_user.role == UserRole.doctor:
        try:
            patient_uuid = UUID(patient_id)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
        if not auth_service._has_active_assignment(db, current_user.id, patient_uuid) and not auth_service._has_active_break_glass(db, current_user.id, patient_uuid):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not assigned to this patient.",
            )

    updated = patient_service.update_patient(db, patient, payload)
    notify_staff(db, current_user, background_tasks, "updated", f"{updated.first_name} {updated.last_name}")
    return updated


@router.delete("/{patient_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("20/minute")
def delete_patient(
    request: Request,
    patient_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_admin_user),
):
    """Delete patient (admin only)"""
    patient = patient_service.get_patient(db, patient_id)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    
    patient_name = f"{patient.first_name} {patient.last_name}"
    patient_service.delete_patient(db, patient)
    notify_staff(db, current_user, background_tasks, "deleted", patient_name)
    return None


class BulkDeleteRequest(BaseModel):
    ids: List[str]


class BulkDeleteResponse(BaseModel):
    deleted: int
    errors: List[str]


@router.post("/bulk-delete", response_model=BulkDeleteResponse)
@limiter.limit("10/minute")
def bulk_delete_patients(
    request: Request,
    payload: BulkDeleteRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_admin_user),
):
    """Bulk delete patients (admin only)."""
    deleted = 0
    errors: List[str] = []

    for patient_id in payload.ids:
        patient = patient_service.get_patient(db, patient_id)
        if not patient:
            errors.append(f"Patient {patient_id} not found")
            continue
        patient_name = f"{patient.first_name} {patient.last_name}"
        patient_service.delete_patient(db, patient)
        notify_staff(db, current_user, background_tasks, "deleted", patient_name)
        deleted += 1

    return BulkDeleteResponse(deleted=deleted, errors=errors)
