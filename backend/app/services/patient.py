import json
from typing import List, Literal, Optional, Tuple
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.core.config import get_settings
from app.models.doctor_patient_assignment import DoctorPatientAssignment
from app.models.enums import UserRole
from app.models.patient import Patient
from app.models.user import User
from app.schemas.patient import PatientCreate, PatientUpdate
from app.services import audit as audit_service

settings = get_settings()
AssignmentRole = Literal["primary", "consulting"]
ALLOWED_ASSIGNMENT_ROLES = {"primary", "consulting"}


def create_patient(db: Session, payload: PatientCreate, doctor_id: Optional[UUID] = None) -> Patient:
    patient = Patient(**payload.model_dump())
    db.add(patient)
    db.flush()

    # Auto-assign to doctor if created by a doctor
    if doctor_id:
        assignment = DoctorPatientAssignment(doctor_id=doctor_id, patient_id=patient.id, role="primary")
        db.add(assignment)

    db.commit()
    db.refresh(patient)
    return patient


def list_patient_assignments(db: Session, patient_id: UUID) -> list[DoctorPatientAssignment]:
    assignments = db.scalars(
        select(DoctorPatientAssignment)
        .options(joinedload(DoctorPatientAssignment.doctor))
        .where(DoctorPatientAssignment.patient_id == patient_id)
        .order_by(
            case((DoctorPatientAssignment.role == "primary", 0), else_=1),
            DoctorPatientAssignment.assigned_at.asc(),
            DoctorPatientAssignment.id.asc(),
        )
    ).all()
    return list(assignments)


def _validate_patient_and_doctor(db: Session, patient_id: UUID, doctor_id: UUID) -> User:
    patient_exists = db.scalar(select(Patient.id).where(Patient.id == patient_id))
    if not patient_exists:
        raise ValueError("Patient not found.")

    doctor = db.scalar(
        select(User).where(
            User.id == doctor_id,
            User.deleted_at.is_(None),
            User.is_active == True,  # noqa: E712
        )
    )
    if not doctor:
        raise ValueError("Doctor account not found.")
    if doctor.role != UserRole.doctor:
        raise ValueError("Only doctor accounts can be assigned to patients.")
    return doctor


def _normalize_assignment_role(role: str | None) -> AssignmentRole | None:
    if role is None:
        return None
    normalized = role.strip().lower()
    if normalized not in ALLOWED_ASSIGNMENT_ROLES:
        raise ValueError("Role must be either 'primary' or 'consulting'.")
    return normalized  # type: ignore[return-value]


def _has_active_assignment(db: Session, doctor_id: UUID, patient_id: UUID) -> bool:
    exists = db.scalar(
        select(DoctorPatientAssignment.id).where(
            DoctorPatientAssignment.doctor_id == doctor_id,
            DoctorPatientAssignment.patient_id == patient_id,
        )
    )
    return exists is not None


def _log_patient_access_denied(
    db: Session,
    *,
    current_user: User,
    patient_id: UUID,
    reason: str,
    ip_address: str | None,
) -> None:
    try:
        audit_service.log_action(
            db=db,
            user_id=current_user.id,
            action="patient_access_denied",
            resource_type="patient",
            resource_id=patient_id,
            details=json.dumps(
                {
                    "reason": reason,
                    "role": current_user.role.value,
                }
            ),
            ip_address=ip_address,
        )
    except Exception:
        # Access denial must still be enforced even if audit insert fails.
        pass


def verify_doctor_patient_access(
    db: Session,
    *,
    current_user: User,
    patient_id: UUID,
    ip_address: str | None = None,
) -> None:
    """Enforce phase-1 assignment policy at service layer.

    - Admin: full access
    - Doctor: only assigned patients
    - Others: forbidden
    """
    if current_user.role == UserRole.admin:
        return

    if current_user.role != UserRole.doctor:
        _log_patient_access_denied(
            db,
            current_user=current_user,
            patient_id=patient_id,
            reason="forbidden_role",
            ip_address=ip_address,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Required roles: ['admin', 'doctor']",
        )

    if _has_active_assignment(db, current_user.id, patient_id):
        return

    _log_patient_access_denied(
        db,
        current_user=current_user,
        patient_id=patient_id,
        reason="not_assigned",
        ip_address=ip_address,
    )
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You are not assigned to this patient. Contact admin to assign access.",
    )


def _list_patient_assignments_for_update(
    db: Session,
    patient_id: UUID,
) -> list[DoctorPatientAssignment]:
    assignments = db.scalars(
        select(DoctorPatientAssignment)
        .where(DoctorPatientAssignment.patient_id == patient_id)
        .order_by(DoctorPatientAssignment.assigned_at.asc(), DoctorPatientAssignment.id.asc())
        .with_for_update()
    ).all()
    return list(assignments)


def create_patient_assignment(
    db: Session,
    *,
    patient_id: UUID,
    doctor_id: UUID,
    role: str | None = None,
) -> DoctorPatientAssignment:
    _validate_patient_and_doctor(db, patient_id, doctor_id)

    existing_assignments = _list_patient_assignments_for_update(db, patient_id)
    if any(assignment.doctor_id == doctor_id for assignment in existing_assignments):
        raise ValueError("Doctor is already assigned to this patient.")

    normalized_role = _normalize_assignment_role(role)
    if normalized_role is None:
        normalized_role = "primary" if not existing_assignments else "consulting"

    if normalized_role == "primary":
        for assignment in existing_assignments:
            if assignment.role == "primary":
                assignment.role = "consulting"
                db.add(assignment)
        db.flush()

    assignment = DoctorPatientAssignment(
        patient_id=patient_id,
        doctor_id=doctor_id,
        role=normalized_role,
    )
    db.add(assignment)
    db.flush()
    db.commit()

    created = db.scalar(
        select(DoctorPatientAssignment)
        .options(joinedload(DoctorPatientAssignment.doctor))
        .where(DoctorPatientAssignment.id == assignment.id)
    )
    if not created:
        raise ValueError("Failed to create assignment.")
    return created


def update_patient_assignment(
    db: Session,
    *,
    patient_id: UUID,
    assignment_id: UUID,
    role: str,
) -> DoctorPatientAssignment:
    normalized_role = _normalize_assignment_role(role)
    assert normalized_role is not None

    all_assignments = _list_patient_assignments_for_update(db, patient_id)
    assignment = next(
        (item for item in all_assignments if item.id == assignment_id),
        None,
    )
    if not assignment:
        raise ValueError("Assignment not found.")

    if assignment.role == normalized_role:
        current = db.scalar(
            select(DoctorPatientAssignment)
            .options(joinedload(DoctorPatientAssignment.doctor))
            .where(DoctorPatientAssignment.id == assignment.id)
        )
        if not current:
            raise ValueError("Assignment not found.")
        return current

    if normalized_role == "primary":
        for item in all_assignments:
            if item.id != assignment.id and item.role == "primary":
                item.role = "consulting"
                db.add(item)
        db.flush()
        assignment.role = "primary"
        db.add(assignment)
    else:
        assignment.role = "consulting"
        db.add(assignment)
        db.flush()
        # Keep exactly one primary assignment when records remain.
        remaining = [item for item in all_assignments if item.id != assignment.id]
        if remaining and not any(item.role == "primary" for item in remaining):
            promote = min(
                remaining,
                key=lambda item: (item.assigned_at, str(item.id)),
            )
            promote.role = "primary"
            db.add(promote)

    db.flush()
    db.commit()

    updated = db.scalar(
        select(DoctorPatientAssignment)
        .options(joinedload(DoctorPatientAssignment.doctor))
        .where(DoctorPatientAssignment.id == assignment.id)
    )
    if not updated:
        raise ValueError("Assignment not found.")
    return updated


def delete_patient_assignment(
    db: Session,
    *,
    patient_id: UUID,
    assignment_id: UUID,
) -> DoctorPatientAssignment:
    assignment = db.scalar(
        select(DoctorPatientAssignment).where(
            DoctorPatientAssignment.id == assignment_id,
            DoctorPatientAssignment.patient_id == patient_id,
        )
    )
    if not assignment:
        raise ValueError("Assignment not found.")

    removed_snapshot = db.scalar(
        select(DoctorPatientAssignment)
        .options(joinedload(DoctorPatientAssignment.doctor))
        .where(DoctorPatientAssignment.id == assignment.id)
    )
    if not removed_snapshot:
        raise ValueError("Assignment not found.")

    removed_role = assignment.role
    db.delete(assignment)
    db.flush()

    if removed_role == "primary":
        next_primary = db.scalar(
            select(DoctorPatientAssignment)
            .where(DoctorPatientAssignment.patient_id == patient_id)
            .order_by(DoctorPatientAssignment.assigned_at.asc(), DoctorPatientAssignment.id.asc())
            .limit(1)
        )
        if next_primary:
            next_primary.role = "primary"
            db.add(next_primary)

    db.commit()
    return removed_snapshot


def get_patient(db: Session, patient_id: str) -> Optional[Patient]:
    try:
        uuid_id = UUID(patient_id)
        stmt = select(Patient).where(Patient.id == uuid_id)
        return db.scalar(stmt)
    except ValueError:
        return None


def update_patient(db: Session, patient: Patient, payload: PatientUpdate) -> Patient:
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(patient, key, value)
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


def delete_patient(db: Session, patient: Patient) -> None:
    db.delete(patient)
    db.commit()


def list_patients(
    db: Session,
    page: int,
    limit: int,
    q: Optional[str],
    sort: str,
    order: str,
    doctor_id: Optional[UUID] = None,
) -> Tuple[List[Patient], int]:
    stmt = select(Patient)

    if doctor_id:
        stmt = stmt.join(
            DoctorPatientAssignment,
            DoctorPatientAssignment.patient_id == Patient.id,
        ).where(DoctorPatientAssignment.doctor_id == doctor_id).distinct()

    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(
            or_(
                Patient.first_name.ilike(pattern),
                Patient.last_name.ilike(pattern),
                Patient.email.ilike(pattern),
                Patient.phone.ilike(pattern),
            )
        )

    total = db.scalar(select(func.count()).select_from(stmt.subquery()))

    sort_field = {
        "created_at": Patient.created_at,
        "updated_at": Patient.updated_at,
        "last_name": Patient.last_name,
        "first_name": Patient.first_name,
    }.get(sort, Patient.created_at)

    sort_clause = sort_field.desc() if order.lower() == "desc" else sort_field.asc()
    stmt = stmt.order_by(sort_clause)

    safe_limit = min(limit, settings.max_limit)
    offset = (page - 1) * safe_limit
    stmt = stmt.limit(safe_limit).offset(offset)

    items = db.scalars(stmt).all()
    return items, total


def list_patients_for_user(
    db: Session,
    *,
    current_user: User,
    page: int,
    limit: int,
    q: Optional[str],
    sort: str,
    order: str,
) -> Tuple[List[Patient], int]:
    """List patients with role-aware filtering enforced in service layer."""
    if current_user.role == UserRole.admin:
        doctor_id: Optional[UUID] = None
    elif current_user.role == UserRole.doctor:
        doctor_id = current_user.id
    else:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Required roles: ['admin', 'doctor']",
        )

    return list_patients(
        db,
        page=page,
        limit=limit,
        q=q,
        sort=sort,
        order=order,
        doctor_id=doctor_id,
    )
