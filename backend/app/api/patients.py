import logging
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.limiter import limiter
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.patient_assignment import (
    PatientAssignmentCreate,
    PatientAssignmentListResponse,
    PatientAssignmentOut,
    PatientAssignmentUpdate,
)
from app.schemas.patient import (
    PatientContactDetailsResponse,
    PatientCreate,
    PatientListResponse,
    PatientProfileOut,
    PatientUpdate,
)
from app.services import auth as auth_service
from app.services import patient as patient_service
from app.services import audit as audit_service
from app.core.request_utils import get_client_ip

router = APIRouter(prefix="/patients", tags=["patients"])
settings = get_settings()
logger = logging.getLogger(__name__)


def _mask_people_id(people_id: Optional[str]) -> Optional[str]:
    if not people_id:
        return None
    trimmed = people_id.strip()
    if not trimmed:
        return None
    suffix = trimmed[-4:] if len(trimmed) >= 4 else trimmed
    return f"***{suffix}"


def _patient_audit_details(patient) -> dict:
    """Store minimum necessary metadata (avoid PHI in audit detail payload)."""
    return {
        "patient_id": str(patient.id),
        "people_id_suffix": _mask_people_id(getattr(patient, "people_id", None)),
        "is_active": bool(getattr(patient, "is_active", True)),
    }


def _payload_contains_contact_details(payload: PatientCreate | PatientUpdate) -> bool:
    data = payload.model_dump(exclude_unset=True)
    for field in ("phone", "email", "address"):
        value = data.get(field)
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        return True
    return False


def notify_care_team(
    db: Session,
    current_user: User,
    background_tasks: BackgroundTasks,
    action: str,
    patient_id: str,
):
    """Send notification to care-team members except the current user.

    Uses Novu notification service when enabled. Silently skips if Novu is
    disabled or not configured (``NOVU_ENABLED=false``).
    """
    from app.core.config import get_settings as _get_settings
    _cfg = _get_settings()
    if not _cfg.novu_enabled:
        return

    # Lazy import — only loaded when Novu is actually enabled.
    from app.services import novu as novu_service  # noqa: E402

    stmt = select(User.id).where(User.role.in_([UserRole.admin, UserRole.doctor]))
    user_ids = [str(row[0]) for row in db.execute(stmt).fetchall() if str(row[0]) != str(current_user.id)]
    
    if not user_ids:
        return
    
    actor_user_id = str(current_user.id)
    notify_fn = {
        "created": lambda: novu_service.notify_patient_created(user_ids, patient_id, actor_user_id),
        "updated": lambda: novu_service.notify_patient_updated(user_ids, patient_id, actor_user_id),
        "deleted": lambda: novu_service.notify_patient_deleted(user_ids, patient_id, actor_user_id),
    }.get(action)
    
    if notify_fn:
        background_tasks.add_task(notify_fn)


@router.post("", response_model=PatientProfileOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("60/minute")
def create_patient(
    request: Request,
    payload: PatientCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    """Create new patient (admin or doctor)."""
    if current_user.role not in (UserRole.admin, UserRole.doctor):
        raise HTTPException(status_code=403, detail="Access denied")
    if _payload_contains_contact_details(payload):
        auth_service.require_recent_sensitive_session(
            request,
            error_status=status.HTTP_403_FORBIDDEN,
        )
    doctor_id = current_user.id if current_user.role == UserRole.doctor else None
    patient = patient_service.create_patient(db, payload, doctor_id=doctor_id)
    audit_service.log_action(
        db=db,
        user_id=current_user.id,
        action="create_patient",
        resource_type="patient",
        resource_id=patient.id,
        details={"patient_id": str(patient.id)},
        ip_address=get_client_ip(request),
    )
    notify_care_team(db, current_user, background_tasks, "created", str(patient.id))
    return patient


@router.get("", response_model=PatientListResponse)
@limiter.limit("200/minute")
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

    - Admin: can list all patients.
    - Doctor: can list assigned patients.
    - Medical student: can list assigned patients read-only.
    """
    items, total = patient_service.list_patients_for_user(
        db,
        current_user=current_user,
        page=page,
        limit=min(limit, settings.max_limit),
        q=q,
        sort=sort,
        order=order,
    )
    return PatientListResponse(items=items, page=page, limit=min(limit, settings.max_limit), total=total)


@router.get("/{patient_id}", response_model=PatientProfileOut)
@limiter.limit("200/minute")
def get_patient(
    request: Request,
    patient_id: str,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    """Get patient by ID.

    - Admin: can access all.
    - Doctor: only assigned.
    - Medical student: only assigned (read-only).
    """
    patient = patient_service.get_patient(db, patient_id)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")

    patient_service.verify_doctor_patient_access(
        db,
        current_user=current_user,
        patient_id=patient.id,
        ip_address=get_client_ip(request),
    )

    return patient


@router.get("/{patient_id}/contact", response_model=PatientContactDetailsResponse)
@limiter.limit("120/minute")
def get_patient_contact_details(
    request: Request,
    patient_id: str,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    """Reveal patient contact fields after a recent secure session check."""
    patient = patient_service.get_patient(db, patient_id)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")

    patient_service.verify_doctor_patient_access(
        db,
        current_user=current_user,
        patient_id=patient.id,
        ip_address=get_client_ip(request),
    )
    auth_service.require_recent_sensitive_session(
        request,
        error_status=status.HTTP_403_FORBIDDEN,
    )
    audit_service.log_action(
        db=db,
        user_id=current_user.id,
        action="patient_contact_revealed",
        resource_type="patient",
        resource_id=patient.id,
        details=_patient_audit_details(patient),
        ip_address=get_client_ip(request),
    )
    return PatientContactDetailsResponse(
        phone=patient.phone,
        email=patient.email,
        address=patient.address,
    )


@router.put("/{patient_id}", response_model=PatientProfileOut)
@limiter.limit("60/minute")
def update_patient(
    request: Request,
    patient_id: str,
    payload: PatientUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    """Update patient (admin or assigned doctor)."""
    if not auth_service.can_write_clinical_data(current_user.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    patient = patient_service.get_patient(db, patient_id)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")

    patient_service.verify_doctor_patient_access(
        db,
        current_user=current_user,
        patient_id=patient.id,
        ip_address=get_client_ip(request),
    )
    if _payload_contains_contact_details(payload):
        auth_service.require_recent_sensitive_session(
            request,
            error_status=status.HTTP_403_FORBIDDEN,
        )

    updated = patient_service.update_patient(db, patient, payload)
    notify_care_team(db, current_user, background_tasks, "updated", str(updated.id))

    # Audit: Store only metadata about changed fields (no PHI field values).
    try:
        changed_fields = sorted(payload.model_dump(exclude_unset=True).keys())

        if changed_fields:
            audit_service.log_action(
                db=db,
                user_id=current_user.id,
                action="update_patient",
                resource_type="patient",
                resource_id=updated.id,
                details={
                    "patient_id": str(updated.id),
                    "changed_fields": changed_fields,
                },
                ip_address=get_client_ip(request),
            )
    except Exception:
        # Don't fail the request if audit fails
        logger.exception("Failed to write patient update audit log")

    return updated


@router.get("/{patient_id}/assignments", response_model=PatientAssignmentListResponse)
@limiter.limit("120/minute")
def list_patient_assignments(
    request: Request,
    patient_id: UUID,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_admin_user),
):
    patient = patient_service.get_patient(db, str(patient_id))
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")

    items = patient_service.list_patient_assignments(db, patient_id)
    return PatientAssignmentListResponse(items=items, total=len(items))


@router.post(
    "/{patient_id}/assignments",
    response_model=PatientAssignmentOut,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("60/minute")
def create_patient_assignment(
    request: Request,
    patient_id: UUID,
    payload: PatientAssignmentCreate,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_admin_user),
):
    try:
        assignment = patient_service.create_patient_assignment(
            db,
            patient_id=patient_id,
            doctor_id=payload.doctor_id,
            role=payload.role,
        )
    except ValueError as exc:
        message = str(exc)
        if "already assigned" in message.lower():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message)
        if "not found" in message.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=message)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)
    except IntegrityError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Assignment violates uniqueness constraints.")

    audit_service.log_action(
        db=db,
        user_id=current_user.id,
        action="patient_assignment_create",
        resource_type="doctor_patient_assignment",
        resource_id=assignment.id,
        details=f"Assigned doctor {assignment.doctor_id} to patient {patient_id} as {assignment.role}",
        ip_address=get_client_ip(request),
    )
    return assignment


@router.patch("/{patient_id}/assignments/{assignment_id}", response_model=PatientAssignmentOut)
@limiter.limit("60/minute")
def update_patient_assignment(
    request: Request,
    patient_id: UUID,
    assignment_id: UUID,
    payload: PatientAssignmentUpdate,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_admin_user),
):
    try:
        assignment = patient_service.update_patient_assignment(
            db,
            patient_id=patient_id,
            assignment_id=assignment_id,
            role=payload.role,
        )
    except ValueError as exc:
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=message)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)
    except IntegrityError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Assignment violates uniqueness constraints.")

    audit_service.log_action(
        db=db,
        user_id=current_user.id,
        action="patient_assignment_update",
        resource_type="doctor_patient_assignment",
        resource_id=assignment.id,
        details=f"Updated assignment {assignment_id} for patient {patient_id} to role {assignment.role}",
        ip_address=get_client_ip(request),
    )
    return assignment


@router.delete("/{patient_id}/assignments/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def delete_patient_assignment(
    request: Request,
    patient_id: UUID,
    assignment_id: UUID,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_admin_user),
):
    try:
        removed = patient_service.delete_patient_assignment(
            db,
            patient_id=patient_id,
            assignment_id=assignment_id,
        )
    except ValueError as exc:
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=message)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)

    audit_service.log_action(
        db=db,
        user_id=current_user.id,
        action="patient_assignment_delete",
        resource_type="doctor_patient_assignment",
        resource_id=removed.id,
        details=f"Removed doctor {removed.doctor_id} from patient {patient_id}",
        ip_address=get_client_ip(request),
    )
    return None


@router.delete("/{patient_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
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

    patient_service.delete_patient(db, patient, deleted_by=current_user.id)
    audit_service.log_action(
        db=db,
        user_id=current_user.id,
        action="delete_patient",
        resource_type="patient",
        resource_id=patient.id,
        details=_patient_audit_details(patient),
        ip_address=get_client_ip(request),
    )
    notify_care_team(db, current_user, background_tasks, "deleted", str(patient.id))
    return None


class BulkDeleteRequest(BaseModel):
    ids: List[str]


class BulkDeleteResponse(BaseModel):
    deleted: int
    errors: List[str]


@router.post("/bulk-delete", response_model=BulkDeleteResponse)
@limiter.limit("60/minute")
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
    deleted_ids: List[str] = []

    for patient_id in payload.ids:
        patient = patient_service.get_patient(db, patient_id)
        if not patient:
            errors.append(f"Patient {patient_id} not found")
            continue
        patient_service.delete_patient(db, patient, deleted_by=current_user.id)
        audit_service.log_action(
            db=db,
            user_id=current_user.id,
            action="delete_patient",
            resource_type="patient",
            resource_id=patient.id,
            details={**_patient_audit_details(patient), "bulk": True},
            ip_address=get_client_ip(request),
        )
        notify_care_team(db, current_user, background_tasks, "deleted", str(patient.id))
        deleted += 1
        deleted_ids.append(str(patient.id))

    audit_service.log_action(
        db=db,
        user_id=current_user.id,
        action="bulk_delete_patients",
        resource_type="patient",
        details={"requested_ids": payload.ids, "deleted_ids": deleted_ids, "errors": errors},
        ip_address=get_client_ip(request),
    )

    return BulkDeleteResponse(deleted=deleted, errors=errors)
