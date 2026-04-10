import secrets
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, or_
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.search import normalize_search_term
from app.core.security import get_password_hash
from app.models.audit_log import AuditLog
from app.models.doctor_patient_assignment import DoctorPatientAssignment
from app.models.enums import UserRole, VerificationStatus
from app.models.invite import UserInvite
from app.models.patient import Patient
from app.models.user import User
from app.models.user_privileged_role_assignment import UserPrivilegedRoleAssignment
from app.schemas.user import (
    CLINICAL_ROLES,
    UserCreate,
    UserCreateResponse,
    UserInviteCreateRequest,
    UserInviteCreateResponse,
    UserListResponse,
    UserOut,
    UserUpdate,
)
from app.services import auth as auth_service
from app.services import auth_sessions
from app.services.audit import log_action
from app.services.auth import get_admin_user, get_current_user

router = APIRouter(prefix="/users", tags=["users"])
settings = get_settings()
logger = logging.getLogger(__name__)
HIGH_RISK_PRIVILEGED_MFA_MAX_AGE_SECONDS = 30 * 60


# Use shared utility for consistent IP extraction across all routes.
from app.core.request_utils import get_client_ip as _client_ip  # noqa: E402


def _user_snapshot(user: User) -> dict:
    """Return a JSON-serialisable snapshot of user fields for audit."""
    return {
        "id": str(user.id),
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "role": user.role.value if user.role else None,
        "is_active": user.is_active,
        "specialty": user.specialty,
        "department": user.department,
        "license_no": _mask_license_no(user.license_no),
        "verification_status": user.verification_status.value if user.verification_status else None,
        "two_factor_enabled": user.two_factor_enabled,
        "deleted_at": user.deleted_at.isoformat() if user.deleted_at else None,
        "deleted_by": str(user.deleted_by) if user.deleted_by else None,
        "restored_at": user.restored_at.isoformat() if user.restored_at else None,
        "restored_by": str(user.restored_by) if user.restored_by else None,
    }


def _retired_email(user_id: UUID) -> str:
    """Generate a unique placeholder email for soft-deleted users."""
    return f"deleted+{user_id.hex}@archive.example.com"


def _mask_license_no(license_no: str | None) -> str | None:
    if not license_no:
        return None
    cleaned = license_no.strip()
    if not cleaned:
        return None
    if len(cleaned) <= 4:
        return "*" * len(cleaned)
    return f"{'*' * (len(cleaned) - 4)}{cleaned[-4:]}"


def _normalize_privileged_reason(raw_reason: str | None) -> str:
    reason = (raw_reason or "").strip()
    if len(reason) < 8:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Reason must be at least 8 characters.",
        )
    return reason


def _active_admin_count_for_update(db: Session) -> int:
    admin_ids = db.scalars(
        select(User.id).where(
            User.role == UserRole.admin,
            User.is_active == True,  # noqa: E712
            User.deleted_at.is_(None),
        ).with_for_update()
    ).all()
    return len(admin_ids)


def _restore_email_from_audit(db: Session, user_id: UUID) -> str | None:
    """Find the most recent pre-delete email from audit logs, if available."""
    latest_delete_audit = db.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "user_delete",
            AuditLog.resource_type == "user",
            AuditLog.resource_id == user_id,
        )
        .order_by(AuditLog.created_at.desc())
    )
    if not latest_delete_audit or not latest_delete_audit.details:
        return None

    # JSONB column auto-deserializes to dict in SQLAlchemy, but legacy
    # rows may hold a raw JSON string.  Handle both formats safely.
    raw = latest_delete_audit.details
    if isinstance(raw, dict):
        details = raw
    elif isinstance(raw, str):
        try:
            details = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            return None
    else:
        return None

    if not isinstance(details, dict):
        return None

    before = details.get("before")
    if not isinstance(before, dict):
        return None

    email = before.get("email")
    if not isinstance(email, str):
        return None

    normalized = email.strip().lower()
    return normalized or None


def _restore_soft_deleted_user(
    *,
    db: Session,
    user: User,
    actor_user_id: UUID,
) -> tuple[User, str]:
    """Restore a soft-deleted user and resolve email conflicts."""
    fallback_email = _retired_email(user.id)
    restored_email = _restore_email_from_audit(db, user.id)
    email_source = "existing"
    if restored_email and restored_email != user.email:
        email_taken = db.scalar(
            select(User.id).where(
                User.email == restored_email,
                User.deleted_at.is_(None),
                User.id != user.id,
            )
        )
        if email_taken is None:
            user.email = restored_email
            email_source = "audit"
        else:
            user.email = fallback_email
            email_source = "retired_conflict"
    elif user.email.endswith("@deleted.local"):
        # Normalize legacy placeholder format to a valid domain for API schema validation.
        user.email = fallback_email
        email_source = "retired_normalized"

    user.deleted_at = None
    user.deleted_by = None
    user.is_active = True
    user.restored_at = datetime.now(timezone.utc)
    user.restored_by = actor_user_id
    return user, email_source


def _invite_state(invite: UserInvite, now: datetime) -> str:
    if invite.used_at is not None:
        return "closed"
    expires_at = invite.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= now:
        return "expired"
    return "active"


def _normalize_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _assign_patients_to_new_doctor(
    *,
    db: Session,
    doctor_id: UUID,
    scope: str,
    target_ward: str | None,
) -> tuple[int, int]:
    if scope == "none":
        return 0, 0

    candidate_query = select(Patient.id).where(
        Patient.deleted_at.is_(None),
        Patient.is_active == True,  # noqa: E712
    )
    if scope == "ward":
        candidate_query = candidate_query.where(Patient.ward == target_ward)

    primary_assignment_subquery = select(DoctorPatientAssignment.patient_id).where(
        DoctorPatientAssignment.role == "primary"
    )
    eligible_query = candidate_query.where(Patient.id.not_in(primary_assignment_subquery))

    candidate_count = db.scalar(select(func.count()).select_from(candidate_query.subquery())) or 0
    patient_ids = list(db.scalars(eligible_query))
    if not patient_ids:
        skipped_patient_count = candidate_count
        logger.info(
            "Doctor onboarding auto-assignment found no eligible patients",
            extra={
                "event": "doctor_onboarding_auto_assignment_empty",
                "doctor_id": str(doctor_id),
                "scope": scope,
                "target_ward": target_ward,
                "candidate_patient_count": candidate_count,
                "skipped_patient_count": skipped_patient_count,
            },
        )
        return 0, skipped_patient_count

    skipped_patient_count = candidate_count - len(patient_ids)

    db.add_all(
        [
            DoctorPatientAssignment(
                doctor_id=doctor_id,
                patient_id=patient_id,
                role="consulting",
            )
            for patient_id in patient_ids
        ]
    )
    db.flush()
    logger.info(
        "Doctor onboarding auto-assignment prepared consulting assignments",
        extra={
            "event": "doctor_onboarding_auto_assignment_prepared",
            "doctor_id": str(doctor_id),
            "scope": scope,
            "target_ward": target_ward,
            "assigned_patient_count": len(patient_ids),
            "skipped_patient_count": skipped_patient_count,
        },
    )
    return len(patient_ids), skipped_patient_count


# ---------------------------------------------------------------------------
# LIST  (admin-only)
# ---------------------------------------------------------------------------

@router.get("", response_model=UserListResponse)
def get_users(
    request: Request,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(get_admin_user),
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    q: str = Query(None, min_length=1),
    sort: str = Query("created_at", pattern="^(created_at|updated_at|email|first_name|last_name|role)$"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    role: UserRole = Query(None),
    verification_status: VerificationStatus = Query(None),
    include_deleted: bool = Query(False),
    deleted_only: bool = Query(False),
    clinical_only: bool = Query(False),
) -> Any:
    """List users. Admin only."""
    query = select(User)

    # Soft-delete visibility controls
    if deleted_only:
        query = query.where(User.deleted_at.is_not(None))
    elif not include_deleted:
        query = query.where(User.deleted_at.is_(None))

    if q:
        normalized_query = normalize_search_term(q)
        search = f"%{normalized_query}%"
        full_name = func.trim(
            func.coalesce(User.first_name, "")
            + " "
            + func.coalesce(User.last_name, "")
        )
        query = query.where(
            or_(
                User.email.ilike(search),
                User.first_name.ilike(search),
                User.last_name.ilike(search),
                full_name.ilike(search),
            )
        )

    if role:
        query = query.where(User.role == role)

    if clinical_only:
        query = query.where(User.role.in_(tuple(CLINICAL_ROLES)))

    if verification_status:
        if verification_status == VerificationStatus.unverified:
            query = query.where(
                or_(
                    User.verification_status == verification_status,
                    User.verification_status.is_(None),
                )
            )
        else:
            query = query.where(User.verification_status == verification_status)

    count_query = select(func.count()).select_from(query.subquery())
    total = db.scalar(count_query)

    # Sorting
    if hasattr(User, sort):
        sort_column = getattr(User, sort)
    else:
        sort_column = User.created_at

    if order == "desc":
        query = query.order_by(sort_column.desc())
    else:
        query = query.order_by(sort_column.asc())

    query = query.offset((page - 1) * limit).limit(limit)
    users = db.scalars(query).all()
    user_ids = [user.id for user in users]
    privilege_map: dict[UUID, list[str]] = {}
    if user_ids:
        assignments = db.scalars(
            select(UserPrivilegedRoleAssignment).where(
                UserPrivilegedRoleAssignment.user_id.in_(user_ids),
                UserPrivilegedRoleAssignment.revoked_at.is_(None),
            )
        ).all()
        for assignment in assignments:
            privilege_map.setdefault(assignment.user_id, []).append(assignment.role.value)

    items = [
        UserOut.model_validate(user).model_copy(
            update={"privileged_roles": sorted(privilege_map.get(user.id, []))}
        )
        for user in users
    ]

    return UserListResponse(
        items=items,
        page=page,
        limit=limit,
        total=total if total else 0,
    )


# ---------------------------------------------------------------------------
# CREATE  (admin-only)
# ---------------------------------------------------------------------------

@router.post("", response_model=UserCreateResponse)
def create_user(
    *,
    request: Request,
    db: Session = Depends(auth_service.get_db),
    user_in: UserCreate,
    current_user: User = Depends(get_admin_user),
) -> Any:
    """Create a new user. Admin only."""
    if user_in.role == UserRole.admin:
        auth_service.require_recent_privileged_session(request, current_user)

    if settings.specialist_invite_only and auth_service.can_receive_user_invite(user_in.role):
        raise HTTPException(
            status_code=400,
            detail="Accounts for this role must be onboarded via invite flow.",
        )

    requested_email = user_in.email.lower()

    existing = db.scalar(select(User).where(User.email == requested_email))
    if existing and existing.deleted_at is None:
        raise HTTPException(
            status_code=400,
            detail="A user with this email already exists.",
        )
    if existing and existing.deleted_at is not None:
        # Legacy deleted row still using this email; retire it so email can be reused.
        existing.email = _retired_email(existing.id)
        db.add(existing)
        db.flush()

    # Validate clinical roles require minimum professional data
    if user_in.role in CLINICAL_ROLES and not user_in.license_no:
        raise HTTPException(
            status_code=422,
            detail="Clinical roles require a license number.",
        )

    normalized_password = user_in.password.strip() if isinstance(user_in.password, str) else None
    if user_in.role == UserRole.admin and not auth_service.can_manage_privileged_admins(current_user, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super admin only.",
        )
    if user_in.role == UserRole.admin:
        raise HTTPException(
            status_code=400,
            detail="Admin accounts must be created through invite flow.",
        )
    if user_in.role != UserRole.admin and not normalized_password:
        raise HTTPException(
            status_code=422,
            detail="Direct user creation requires a password.",
        )

    user = User(
        email=requested_email,
        password_hash=get_password_hash(normalized_password or secrets.token_urlsafe(32)),
        first_name=user_in.first_name,
        last_name=user_in.last_name,
        role=user_in.role,
        is_active=user_in.is_active,
        specialty=user_in.specialty,
        department=user_in.department,
        license_no=user_in.license_no,
        license_expiry=user_in.license_expiry,
        verification_status=user_in.verification_status,
    )
    db.add(user)
    db.flush()

    assigned_patient_count = 0
    skipped_patient_count = 0
    if user.role == UserRole.doctor:
        assigned_patient_count, skipped_patient_count = _assign_patients_to_new_doctor(
            db=db,
            doctor_id=user.id,
            scope=user_in.patient_assignment_scope,
            target_ward=user_in.target_ward,
        )

    db.commit()
    db.refresh(user)

    log_action(
        db,
        user_id=current_user.id,
        action="user_create",
        resource_type="user",
        resource_id=user.id,
        details={
            "after": _user_snapshot(user),
            "patient_assignment_scope": user_in.patient_assignment_scope,
            "target_ward": user_in.target_ward,
            "assigned_patient_count": assigned_patient_count,
            "skipped_patient_count": skipped_patient_count,
        },
        ip_address=_client_ip(request),
    )

    logger.info(
        "User created",
        extra={
            "event": "user_created",
            "user_id": str(user.id),
            "role": user.role.value,
            "actor_user_id": str(current_user.id),
            "assigned_patient_count": assigned_patient_count,
            "skipped_patient_count": skipped_patient_count,
            "patient_assignment_scope": user_in.patient_assignment_scope,
        },
    )
    return UserCreateResponse.model_validate(user).model_copy(
        update={"assigned_patient_count": assigned_patient_count}
    )


# ---------------------------------------------------------------------------
# INVITE  (admin-only)
# ---------------------------------------------------------------------------

@router.post("/invites", response_model=UserInviteCreateResponse)
def create_user_invite(
    *,
    request: Request,
    db: Session = Depends(auth_service.get_db),
    payload: UserInviteCreateRequest,
    current_user: User = Depends(get_admin_user),
) -> Any:
    """Create an invite link. Admin only."""
    invite_reason: str | None = None
    if payload.role == UserRole.admin:
        auth_service.require_recent_privileged_session(
            request,
            current_user,
            max_age_seconds=HIGH_RISK_PRIVILEGED_MFA_MAX_AGE_SECONDS,
        )
        invite_reason = _normalize_privileged_reason(payload.reason)
    if payload.role == UserRole.admin and not auth_service.can_manage_privileged_admins(current_user, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super admin only.",
        )
    if not auth_service.can_receive_user_invite(payload.role):
        raise HTTPException(
            status_code=422,
            detail="Invite onboarding is restricted to supported roles in this phase.",
        )

    requested_email = payload.email.lower()
    existing_user = db.scalar(
        select(User).where(
            User.email == requested_email,
            User.deleted_at.is_(None),
        )
    )
    if existing_user:
        raise HTTPException(
            status_code=400,
            detail="A user with this email already exists.",
        )

    legacy_deleted = db.scalar(
        select(User).where(
            User.email == requested_email,
            User.deleted_at.is_not(None),
        )
    )
    if legacy_deleted:
        legacy_deleted.email = _retired_email(legacy_deleted.id)
        db.add(legacy_deleted)
        db.flush()

    raw_token, invite = auth_service.create_user_invite(
        db,
        email=requested_email,
        role=payload.role,
        expires_in_hours=settings.invite_expires_in_hours,
        created_by=current_user,
    )
    invite_url = f"{settings.frontend_base_url.rstrip('/')}/invite#token={raw_token}"

    log_action(
        db,
        user_id=current_user.id,
        action="user_invite",
        resource_type="user_invite",
        resource_id=invite.id,
        details={
            "email": payload.email,
            "role": payload.role.value,
            "reason": invite_reason,
        },
        ip_address=_client_ip(request),
    )

    return UserInviteCreateResponse(invite_url=invite_url, expires_at=invite.expires_at)


# ---------------------------------------------------------------------------
# READ ONE
# ---------------------------------------------------------------------------

@router.get("/{user_id:uuid}", response_model=UserOut)
def read_user_by_id(
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(auth_service.get_db),
) -> Any:
    """Get a specific user. Admins can read anyone; others can read themselves."""
    if current_user.role != UserRole.admin and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    user = db.scalar(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return user


# ---------------------------------------------------------------------------
# UPDATE  (admin or self)
# ---------------------------------------------------------------------------

@router.put("/{user_id:uuid}", response_model=UserOut)
def update_user(
    *,
    request: Request,
    db: Session = Depends(auth_service.get_db),
    user_id: UUID,
    user_in: UserUpdate,
    current_user: User = Depends(get_current_user),
) -> Any:
    """Update a user. Admin can update anyone; users can update themselves."""
    if current_user.role != UserRole.admin and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    user = db.scalar(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Non-admins cannot change role, is_active, or verification_status
    if current_user.role != UserRole.admin:
        restricted = {"role", "is_active", "verification_status"}
        update_data = user_in.model_dump(exclude_unset=True)
        if restricted & update_data.keys():
            raise HTTPException(
                status_code=403,
                detail="Only admins can change role, active status, or verification status.",
            )

    before = _user_snapshot(user)
    email_change_requested = bool(user_in.email) and user_in.email.lower() != user.email
    is_self_service_email_change = (
        current_user.role != UserRole.admin
        and current_user.id == user_id
        and email_change_requested
    )

    if user_in.email:
        normalized_email = user_in.email.lower()
        if is_self_service_email_change:
            auth_payload = getattr(request.state, "auth_payload", None)
            auth_payload = auth_payload if isinstance(auth_payload, dict) else {}
            mfa_authenticated_at = auth_service._coerce_timestamp(auth_payload.get("mfa_authenticated_at"))
            mfa_max_age = settings.privileged_action_mfa_max_age_seconds
            if not auth_service.is_recent_mfa_authenticated(
                mfa_authenticated_at,
                max_age_seconds=mfa_max_age,
            ):
                log_action(
                    db,
                    user_id=current_user.id,
                    action="user_email_change_attempt",
                    resource_type="user",
                    resource_id=user.id,
                    details={
                        "status": "failure",
                        "reason": "recent_mfa_required",
                        "old_email": user.email,
                        "new_email": normalized_email,
                        "mfa_max_age_seconds": mfa_max_age,
                    },
                    ip_address=_client_ip(request),
                    status="failure",
                    commit=False,
                )
                raise HTTPException(
                    status_code=403,
                    detail="Recent MFA verification required to change email address.",
                )
        dup = db.scalar(
            select(User).where(
                User.email == normalized_email,
                User.deleted_at.is_(None),
            )
        )
        if dup and dup.id != user_id:
            if is_self_service_email_change:
                log_action(
                    db,
                    user_id=current_user.id,
                    action="user_email_change_attempt",
                    resource_type="user",
                    resource_id=user.id,
                    details={
                        "status": "failure",
                        "reason": "email_already_in_use",
                        "old_email": user.email,
                        "new_email": normalized_email,
                    },
                    ip_address=_client_ip(request),
                    status="failure",
                    commit=False,
                )
            raise HTTPException(status_code=400, detail="Email already in use.")

        legacy_deleted = db.scalar(
            select(User).where(
                User.email == normalized_email,
                User.deleted_at.is_not(None),
            )
        )
        if legacy_deleted and legacy_deleted.id != user_id:
            legacy_deleted.email = _retired_email(legacy_deleted.id)
            db.add(legacy_deleted)
            db.flush()

    update_data = user_in.model_dump(exclude_unset=True)
    if "email" in update_data and update_data["email"]:
        update_data["email"] = str(update_data["email"]).lower()

    # Hash password if provided
    if "password" in update_data and update_data["password"]:
        auth_service.reset_user_password(db, user, update_data.pop("password"))
        auth_sessions.revoke_user_sessions(db, user_id=user.id)
    else:
        update_data.pop("password", None)

    # Keep at least N active admins in the system.
    current_is_active_admin = user.role == UserRole.admin and user.is_active
    next_role = update_data.get("role", user.role)
    next_is_active = update_data.get("is_active", user.is_active)
    next_is_active_admin = next_role == UserRole.admin and next_is_active
    if current_is_active_admin and not next_is_active_admin:
        if _active_admin_count_for_update(db) <= settings.min_active_admin_accounts:
            raise HTTPException(
                status_code=400,
                detail=f"At least {settings.min_active_admin_accounts} active admin accounts are required.",
            )

    for field, value in update_data.items():
        if hasattr(user, field):
            setattr(user, field, value)

    db.add(user)
    db.commit()
    db.refresh(user)

    after = _user_snapshot(user)
    if is_self_service_email_change:
        log_action(
            db,
            user_id=current_user.id,
            action="user_email_change_attempt",
            resource_type="user",
            resource_id=user.id,
            details={
                "status": "success",
                "old_email": before["email"],
                "new_email": after["email"],
                "mfa_max_age_seconds": settings.privileged_action_mfa_max_age_seconds,
            },
            ip_address=_client_ip(request),
            commit=False,
        )
    log_action(
        db,
        user_id=current_user.id,
        action="user_update",
        resource_type="user",
        resource_id=user.id,
        details={"before": before, "after": after},
        ip_address=_client_ip(request),
    )

    logger.info("User updated: id=%s actor_id=%s", user.id, current_user.id)
    return user


# ---------------------------------------------------------------------------
# VERIFY  (admin-only)
# ---------------------------------------------------------------------------

@router.post("/{user_id:uuid}/verify", response_model=UserOut)
def verify_user(
    *,
    request: Request,
    db: Session = Depends(auth_service.get_db),
    user_id: UUID,
    current_user: User = Depends(get_admin_user),
) -> Any:
    """Set a user's verification_status to verified. Admin only."""
    user = db.scalar(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    before_status = user.verification_status.value if user.verification_status else None
    user.verification_status = VerificationStatus.verified
    db.add(user)
    db.commit()
    db.refresh(user)

    log_action(
        db,
        user_id=current_user.id,
        action="user_verify",
        resource_type="user",
        resource_id=user.id,
        details={"before": before_status, "after": "verified"},
        ip_address=_client_ip(request),
    )

    return user


# ---------------------------------------------------------------------------
# DELETE  (admin-only, soft delete)
# ---------------------------------------------------------------------------

@router.delete("/{user_id:uuid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    *,
    request: Request,
    db: Session = Depends(auth_service.get_db),
    user_id: UUID,
    current_user: User = Depends(get_admin_user),
) -> None:
    """Soft-delete a user. Admin only."""
    user = db.scalar(
        select(User).where(User.id == user_id, User.deleted_at.is_(None)).with_for_update()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Prevent self-delete
    if user.id == current_user.id:
        log_action(
            db,
            user_id=current_user.id,
            action="user_delete_denied",
            resource_type="user",
            resource_id=user.id,
            details={"reason": "cannot_delete_self"},
            ip_address=_client_ip(request),
        )
        raise HTTPException(status_code=400, detail="Cannot delete yourself.")

    # Keep minimum active admin count.
    if (
        user.role == UserRole.admin
        and user.is_active
        and _active_admin_count_for_update(db) <= settings.min_active_admin_accounts
    ):
        log_action(
            db,
            user_id=current_user.id,
            action="user_delete_denied",
            resource_type="user",
            resource_id=user.id,
            details={
                "reason": "minimum_admin_requirement",
                "min_active_admin_accounts": settings.min_active_admin_accounts,
            },
            ip_address=_client_ip(request),
        )
        raise HTTPException(
            status_code=400,
            detail=f"At least {settings.min_active_admin_accounts} active admin accounts are required.",
        )

    before = _user_snapshot(user)
    user.email = _retired_email(user.id)
    user.deleted_at = datetime.now(timezone.utc)
    user.deleted_by = current_user.id
    user.is_active = False
    user.restored_at = None
    user.restored_by = None
    db.add(user)
    db.commit()

    log_action(
        db,
        user_id=current_user.id,
        action="user_delete",
        resource_type="user",
        resource_id=user.id,
        details={"before": before},
        ip_address=_client_ip(request),
    )

    logger.info("User soft-deleted: id=%s actor_id=%s", user_id, current_user.id)
    return None


# ---------------------------------------------------------------------------
# RESTORE  (admin-only, soft delete rollback)
# ---------------------------------------------------------------------------

@router.post("/{user_id:uuid}/restore", response_model=UserOut)
def restore_user(
    *,
    request: Request,
    db: Session = Depends(auth_service.get_db),
    user_id: UUID,
    current_user: User = Depends(get_admin_user),
) -> Any:
    """Restore a soft-deleted user account. Admin only."""
    user = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.deleted_at is None:
        raise HTTPException(status_code=400, detail="User is not deleted.")

    before = _user_snapshot(user)
    user, email_source = _restore_soft_deleted_user(
        db=db,
        user=user,
        actor_user_id=current_user.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    log_action(
        db,
        user_id=current_user.id,
        action="user_restore",
        resource_type="user",
        resource_id=user.id,
        details={
            "before": before,
            "after": _user_snapshot(user),
            "email_source": email_source,
        },
        ip_address=_client_ip(request),
    )

    return user


# ---------------------------------------------------------------------------
# BULK DELETE  (admin-only, soft delete)
# ---------------------------------------------------------------------------

class BulkDeleteRequest(BaseModel):
    ids: List[str]
    confirm_text: Optional[str] = None


class BulkDeleteResponse(BaseModel):
    deleted: int
    skipped: List[str]


class BulkRestoreRequest(BaseModel):
    ids: List[str]


class BulkRestoreResponse(BaseModel):
    restored: int
    skipped: List[str]


class PurgeDeletedUsersRequest(BaseModel):
    older_than_days: int = Field(default=90, ge=1, le=3650)
    confirm_text: str = Field(min_length=5, max_length=20)
    reason: str = Field(min_length=8, max_length=300)


class PurgeDeletedUsersResponse(BaseModel):
    purged: int


class PurgeDeletedUserResponse(BaseModel):
    message: str
    purged_user_id: UUID


class UserInviteOut(BaseModel):
    id: UUID
    email: str
    role: UserRole
    created_by: UUID | None = None
    created_at: datetime
    expires_at: datetime
    used_at: datetime | None = None
    status: str


class UserInviteListResponse(BaseModel):
    items: List[UserInviteOut]
    total: int
    page: int
    limit: int


class InviteActionResponse(BaseModel):
    message: str


@router.get("/invites", response_model=UserInviteListResponse)
def list_user_invites(
    *,
    request: Request,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(get_admin_user),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    q: str | None = Query(None, min_length=1),
    status_filter: str = Query(default="active", pattern="^(active|expired|closed|all)$"),
) -> Any:
    """List invite records with lifecycle status. Admin only."""
    now = datetime.now(timezone.utc)
    query = select(UserInvite)

    if q:
        query = query.where(UserInvite.email.ilike(f"%{q.lower()}%"))

    if status_filter == "active":
        query = query.where(
            UserInvite.used_at.is_(None),
            UserInvite.expires_at > now,
        )
    elif status_filter == "expired":
        query = query.where(
            UserInvite.used_at.is_(None),
            UserInvite.expires_at <= now,
        )
    elif status_filter == "closed":
        query = query.where(UserInvite.used_at.is_not(None))

    count_query = select(func.count()).select_from(query.subquery())
    total = db.scalar(count_query) or 0

    invite_rows = db.scalars(
        query.order_by(UserInvite.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    ).all()

    items = [
        UserInviteOut(
            id=invite.id,
            email=invite.email,
            role=invite.role,
            created_by=invite.created_by,
            created_at=invite.created_at,
            expires_at=invite.expires_at,
            used_at=invite.used_at,
            status=_invite_state(invite, now),
        )
        for invite in invite_rows
    ]
    return UserInviteListResponse(items=items, total=total, page=page, limit=limit)


@router.post("/invites/{invite_id}/resend", response_model=UserInviteCreateResponse)
def resend_user_invite(
    *,
    request: Request,
    invite_id: UUID,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(get_admin_user),
) -> Any:
    """Re-issue a fresh invite token for the same email/role. Admin only."""
    invite = db.scalar(select(UserInvite).where(UserInvite.id == invite_id))
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found.")

    if invite.role == UserRole.admin:
        auth_service.require_recent_privileged_session(
            request,
            current_user,
            max_age_seconds=HIGH_RISK_PRIVILEGED_MFA_MAX_AGE_SECONDS,
        )
    if invite.role == UserRole.admin and not auth_service.can_manage_privileged_admins(current_user, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super admin only.",
        )

    if not auth_service.can_receive_user_invite(invite.role):
        raise HTTPException(
            status_code=400,
            detail="Invite onboarding is restricted to supported roles in this phase.",
        )

    existing_user = db.scalar(
        select(User.id).where(
            User.email == invite.email,
            User.deleted_at.is_(None),
        )
    )
    if existing_user:
        raise HTTPException(
            status_code=400,
            detail="A user with this invite email already exists.",
        )

    raw_token, new_invite = auth_service.create_user_invite(
        db,
        email=invite.email,
        role=invite.role,
        expires_in_hours=settings.invite_expires_in_hours,
        created_by=current_user,
    )
    invite_url = f"{settings.frontend_base_url.rstrip('/')}/invite#token={raw_token}"
    log_action(
        db,
        user_id=current_user.id,
        action="user_invite_resend",
        resource_type="user_invite",
        resource_id=new_invite.id,
        details={
            "previous_invite_id": str(invite.id),
            "new_invite_id": str(new_invite.id),
            "email": invite.email,
            "role": invite.role.value,
        },
        ip_address=_client_ip(request),
    )
    return UserInviteCreateResponse(invite_url=invite_url, expires_at=new_invite.expires_at)


@router.post("/invites/{invite_id}/revoke", response_model=InviteActionResponse)
def revoke_user_invite(
    *,
    request: Request,
    invite_id: UUID,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(get_admin_user),
) -> Any:
    """Revoke an active invite. Admin only."""
    now = datetime.now(timezone.utc)
    invite = db.scalar(select(UserInvite).where(UserInvite.id == invite_id).with_for_update())
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found.")
    if invite.role == UserRole.admin:
        auth_service.require_recent_privileged_session(
            request,
            current_user,
            max_age_seconds=HIGH_RISK_PRIVILEGED_MFA_MAX_AGE_SECONDS,
        )
    if invite.role == UserRole.admin and not auth_service.can_manage_privileged_admins(current_user, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super admin only.",
        )

    if invite.used_at is not None:
        raise HTTPException(status_code=400, detail="Invite is already closed.")
    if _normalize_utc(invite.expires_at) <= now:
        raise HTTPException(status_code=400, detail="Invite is already expired.")

    invite.used_at = now
    db.add(invite)
    db.commit()

    log_action(
        db,
        user_id=current_user.id,
        action="user_invite_revoke",
        resource_type="user_invite",
        resource_id=invite.id,
        details={
            "email": invite.email,
            "role": invite.role.value,
        },
        ip_address=_client_ip(request),
    )
    return InviteActionResponse(message="Invite revoked.")


@router.post("/bulk-delete", response_model=BulkDeleteResponse)
def bulk_delete_users(
    *,
    request: Request,
    db: Session = Depends(auth_service.get_db),
    payload: BulkDeleteRequest,
    current_user: User = Depends(get_admin_user),
) -> Any:
    """Bulk soft-delete users. Admin only."""
    if len(payload.ids) > 3 and payload.confirm_text != "DELETE":
        log_action(
            db,
            user_id=current_user.id,
            action="user_bulk_delete_denied",
            resource_type="user",
            details={
                "reason": "confirm_text_required",
                "requested_count": len(payload.ids),
            },
            ip_address=_client_ip(request),
        )
        raise HTTPException(
            status_code=400,
            detail='Bulk delete over 3 users requires confirm_text="DELETE".',
        )

    deleted = 0
    skipped: List[str] = []
    requested_ids = list(payload.ids)

    for uid_str in payload.ids:
        try:
            user_id = UUID(uid_str)
        except ValueError:
            reason = "invalid ID"
            skipped.append(f"{uid_str}: {reason}")
            log_action(
                db,
                user_id=current_user.id,
                action="user_delete_denied",
                resource_type="user",
                details={"bulk": True, "target_id": uid_str, "reason": "invalid_id"},
                ip_address=_client_ip(request),
            )
            continue

        user = db.scalar(
            select(User).where(User.id == user_id, User.deleted_at.is_(None)).with_for_update()
        )
        if not user:
            reason = "not found"
            skipped.append(f"{uid_str}: {reason}")
            log_action(
                db,
                user_id=current_user.id,
                action="user_delete_denied",
                resource_type="user",
                details={"bulk": True, "target_id": uid_str, "reason": "not_found"},
                ip_address=_client_ip(request),
            )
            continue

        if user.id == current_user.id:
            reason = "cannot delete yourself"
            skipped.append(f"{uid_str}: {reason}")
            log_action(
                db,
                user_id=current_user.id,
                action="user_delete_denied",
                resource_type="user",
                resource_id=user.id,
                details={"bulk": True, "reason": "cannot_delete_self"},
                ip_address=_client_ip(request),
            )
            continue

        if user.role == UserRole.admin and user.is_active:
            if _active_admin_count_for_update(db) <= settings.min_active_admin_accounts:
                reason = "minimum admin requirement"
                skipped.append(f"{uid_str}: {reason}")
                log_action(
                    db,
                    user_id=current_user.id,
                    action="user_delete_denied",
                    resource_type="user",
                    resource_id=user.id,
                    details={
                        "bulk": True,
                        "reason": "minimum_admin_requirement",
                        "min_active_admin_accounts": settings.min_active_admin_accounts,
                    },
                    ip_address=_client_ip(request),
                )
                continue

        before = _user_snapshot(user)
        user.email = _retired_email(user.id)
        user.deleted_at = datetime.now(timezone.utc)
        user.deleted_by = current_user.id
        user.is_active = False
        user.restored_at = None
        user.restored_by = None
        db.add(user)

        log_action(
            db,
            user_id=current_user.id,
            action="user_delete",
            resource_type="user",
            resource_id=user.id,
            details={"before": before, "bulk": True},
            ip_address=_client_ip(request),
        )
        deleted += 1

    # Single commit for all changes — ensures atomicity across the batch
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    log_action(
        db,
        user_id=current_user.id,
        action="user_bulk_delete_summary",
        resource_type="user",
        details={
            "requested_ids": requested_ids,
            "deleted": deleted,
            "skipped": skipped,
        },
        ip_address=_client_ip(request),
    )

    return BulkDeleteResponse(deleted=deleted, skipped=skipped)


@router.post("/{user_id:uuid}/purge", response_model=PurgeDeletedUserResponse)
def purge_deleted_user(
    *,
    request: Request,
    db: Session = Depends(auth_service.get_db),
    user_id: UUID,
    current_user: User = Depends(get_admin_user),
) -> Any:
    """Hard-delete a single soft-deleted medical student. Admin only."""
    user = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if not user:
        log_action(
            db,
            user_id=current_user.id,
            action="user_purge_single_denied",
            resource_type="user",
            details={"target_id": str(user_id), "reason": "not_found"},
            ip_address=_client_ip(request),
        )
        raise HTTPException(status_code=404, detail="User not found")

    if user.deleted_at is None:
        log_action(
            db,
            user_id=current_user.id,
            action="user_purge_single_denied",
            resource_type="user",
            resource_id=user.id,
            details={"reason": "not_deleted"},
            ip_address=_client_ip(request),
        )
        raise HTTPException(status_code=400, detail="Only deleted users can be purged individually.")

    if user.role != UserRole.medical_student:
        log_action(
            db,
            user_id=current_user.id,
            action="user_purge_single_denied",
            resource_type="user",
            resource_id=user.id,
            details={
                "reason": "unsupported_role",
                "role": user.role.value if user.role else None,
            },
            ip_address=_client_ip(request),
        )
        raise HTTPException(
            status_code=403,
            detail="Individual purge is limited to deleted medical students.",
        )

    before = _user_snapshot(user)
    db.delete(user)
    db.commit()

    log_action(
        db,
        user_id=current_user.id,
        action="user_purge_single",
        resource_type="user",
        resource_id=user_id,
        details={"before": before, "mode": "single"},
        ip_address=_client_ip(request),
    )

    return PurgeDeletedUserResponse(
        message="Deleted medical student permanently.",
        purged_user_id=user_id,
    )


@router.post("/bulk-restore", response_model=BulkRestoreResponse)
def bulk_restore_users(
    *,
    request: Request,
    db: Session = Depends(auth_service.get_db),
    payload: BulkRestoreRequest,
    current_user: User = Depends(get_admin_user),
) -> Any:
    """Bulk restore soft-deleted users. Admin only."""
    restored = 0
    skipped: List[str] = []
    requested_ids = list(payload.ids)

    for uid_str in payload.ids:
        try:
            user_id = UUID(uid_str)
        except ValueError:
            reason = "invalid ID"
            skipped.append(f"{uid_str}: {reason}")
            log_action(
                db,
                user_id=current_user.id,
                action="user_restore_denied",
                resource_type="user",
                details={"bulk": True, "target_id": uid_str, "reason": "invalid_id"},
                ip_address=_client_ip(request),
            )
            continue

        user = db.scalar(select(User).where(User.id == user_id).with_for_update())
        if not user:
            reason = "not found"
            skipped.append(f"{uid_str}: {reason}")
            log_action(
                db,
                user_id=current_user.id,
                action="user_restore_denied",
                resource_type="user",
                details={"bulk": True, "target_id": uid_str, "reason": "not_found"},
                ip_address=_client_ip(request),
            )
            continue

        if user.deleted_at is None:
            reason = "not deleted"
            skipped.append(f"{uid_str}: {reason}")
            log_action(
                db,
                user_id=current_user.id,
                action="user_restore_denied",
                resource_type="user",
                resource_id=user.id,
                details={"bulk": True, "reason": "not_deleted"},
                ip_address=_client_ip(request),
            )
            continue

        before = _user_snapshot(user)
        user, email_source = _restore_soft_deleted_user(
            db=db,
            user=user,
            actor_user_id=current_user.id,
        )
        db.add(user)
        db.commit()

        log_action(
            db,
            user_id=current_user.id,
            action="user_restore",
            resource_type="user",
            resource_id=user.id,
            details={
                "before": before,
                "after": _user_snapshot(user),
                "bulk": True,
                "email_source": email_source,
            },
            ip_address=_client_ip(request),
        )
        restored += 1

    log_action(
        db,
        user_id=current_user.id,
        action="user_bulk_restore_summary",
        resource_type="user",
        details={
            "requested_ids": requested_ids,
            "restored": restored,
            "skipped": skipped,
        },
        ip_address=_client_ip(request),
    )

    return BulkRestoreResponse(restored=restored, skipped=skipped)


@router.post("/purge-deleted", response_model=PurgeDeletedUsersResponse)
def purge_deleted_users(
    *,
    request: Request,
    db: Session = Depends(auth_service.get_db),
    payload: PurgeDeletedUsersRequest,
    current_user: User = Depends(get_admin_user),
) -> Any:
    """Hard-delete soft-deleted accounts older than the configured threshold."""
    if payload.confirm_text != "PURGE":
        log_action(
            db,
            user_id=current_user.id,
            action="user_purge_deleted_denied",
            resource_type="user",
            details={
                "reason": "confirm_text_required",
                "older_than_days": payload.older_than_days,
            },
            ip_address=_client_ip(request),
        )
        raise HTTPException(
            status_code=400,
            detail='Purge requires confirm_text="PURGE".',
        )

    reason = payload.reason.strip()
    if len(reason) < 8:
        raise HTTPException(status_code=422, detail="Purge reason must be at least 8 characters.")

    cutoff = datetime.now(timezone.utc) - timedelta(days=payload.older_than_days)
    users_to_purge = db.scalars(
        select(User)
        .where(
            User.deleted_at.is_not(None),
            User.deleted_at <= cutoff,
        )
        .with_for_update()
    ).all()

    purged = len(users_to_purge)
    for user in users_to_purge:
        db.delete(user)
    db.commit()

    log_action(
        db,
        user_id=current_user.id,
        action="user_purge_deleted_summary",
        resource_type="user",
        details={
            "older_than_days": payload.older_than_days,
            "purged": purged,
            "cutoff": cutoff.isoformat(),
            "reason": reason,
        },
        ip_address=_client_ip(request),
    )

    return PurgeDeletedUsersResponse(purged=purged)
