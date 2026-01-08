from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.user import User
from app.schemas.patient import PatientCreate, PatientListResponse, PatientOut, PatientUpdate
from app.services import auth as auth_service
from app.services import patient as patient_service

router = APIRouter(prefix="/patients", tags=["patients"])
settings = get_settings()


@router.post("", response_model=PatientOut, status_code=status.HTTP_201_CREATED)
def create_patient(
    payload: PatientCreate,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_admin_or_staff_user),
):
    """Create new patient (admin or staff)"""
    return patient_service.create_patient(db, payload)


@router.get("", response_model=PatientListResponse)
def list_patients(
    page: int = Query(default=settings.default_page, ge=1),
    limit: int = Query(default=settings.default_limit, ge=1),
    q: Optional[str] = Query(default=None, description="Search term"),
    sort: str = Query(default="created_at", pattern="^(created_at|updated_at|last_name|first_name)$"),
    order: str = Query(default="desc", pattern="^(asc|desc)$", description="Sort order"),
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_admin_or_staff_user),
):
    """List patients with pagination (admin or staff)"""
    # Cap limit to max_limit to prevent excessive resource usage
    actual_limit = min(limit, settings.max_limit)
    items, total = patient_service.list_patients(db, page, actual_limit, q, sort, order)
    return PatientListResponse(items=items, page=page, limit=actual_limit, total=total)


@router.get("/{patient_id}", response_model=PatientOut)
def get_patient(
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
def update_patient(
    patient_id: str,
    payload: PatientUpdate,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_admin_or_staff_user),
):
    """Update patient (admin or staff)"""
    patient = patient_service.get_patient(db, patient_id)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    return patient_service.update_patient(db, patient, payload)


@router.delete("/{patient_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_patient(
    patient_id: str,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_admin_user),  # Admin only for delete
):
    """Delete patient (admin only)"""
    patient = patient_service.get_patient(db, patient_id)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    patient_service.delete_patient(db, patient)
    return None
