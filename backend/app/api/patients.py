from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status, BackgroundTasks
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.user import User, UserRole
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
    current_user: User = Depends(auth_service.get_admin_or_staff_user),
):
    """Create new patient (admin or staff)"""
    patient = patient_service.create_patient(db, payload)
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
    current_user: User = Depends(auth_service.get_admin_or_staff_user),
):
    """List patients with pagination (admin or staff)"""
    items, total = patient_service.list_patients(db, page, min(limit, settings.max_limit), q, sort, order)
    return PatientListResponse(items=items, page=page, limit=min(limit, settings.max_limit), total=total)


@router.get("/{patient_id}", response_model=PatientOut)
@limiter.limit("60/minute")
def get_patient(
    request: Request,
    patient_id: str,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_admin_or_staff_user),
):
    """Get patient by ID (admin or staff)"""
    patient = patient_service.get_patient(db, patient_id)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    return patient


@router.put("/{patient_id}", response_model=PatientOut)
@limiter.limit("30/minute")
def update_patient(
    request: Request,
    patient_id: str,
    payload: PatientUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_admin_or_staff_user),
):
    """Update patient (admin or staff)"""
    patient = patient_service.get_patient(db, patient_id)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    
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
