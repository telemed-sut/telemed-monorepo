import json
from datetime import datetime, timezone
from typing import Any, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import func, select, or_
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import get_password_hash
from app.models.enums import UserRole, VerificationStatus
from app.models.user import User
from app.schemas.user import (
    CLINICAL_ROLES,
    UserCreate,
    UserInviteCreateRequest,
    UserInviteCreateResponse,
    UserListResponse,
    UserOut,
    UserUpdate,
)
from app.services import auth as auth_service
from app.services.audit import log_action
from app.services.auth import get_admin_user, get_current_user

router = APIRouter(prefix="/users", tags=["users"])
settings = get_settings()


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


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
    }


def _retired_email(user_id: UUID) -> str:
    """Generate a unique placeholder email for soft-deleted users."""
    return f"deleted+{user_id.hex}@deleted.local"


def _mask_license_no(license_no: str | None) -> str | None:
    if not license_no:
        return None
    cleaned = license_no.strip()
    if not cleaned:
        return None
    if len(cleaned) <= 4:
        return "*" * len(cleaned)
    return f"{'*' * (len(cleaned) - 4)}{cleaned[-4:]}"


def _active_admin_count_for_update(db: Session) -> int:
    admin_ids = db.scalars(
        select(User.id).where(
            User.role == UserRole.admin,
            User.is_active == True,  # noqa: E712
            User.deleted_at.is_(None),
        ).with_for_update()
    ).all()
    return len(admin_ids)


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
    clinical_only: bool = Query(False),
) -> Any:
    """List users. Admin only."""
    query = select(User)

    # Exclude soft-deleted unless explicitly requested
    if not include_deleted:
        query = query.where(User.deleted_at.is_(None))

    if q:
        search = f"%{q}%"
        query = query.where(
            or_(
                User.email.ilike(search),
                User.first_name.ilike(search),
                User.last_name.ilike(search),
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

    return UserListResponse(
        items=list(users),
        page=page,
        limit=limit,
        total=total if total else 0,
    )


# ---------------------------------------------------------------------------
# CREATE  (admin-only)
# ---------------------------------------------------------------------------

@router.post("", response_model=UserOut)
def create_user(
    *,
    request: Request,
    db: Session = Depends(auth_service.get_db),
    user_in: UserCreate,
    current_user: User = Depends(get_admin_user),
) -> Any:
    """Create a new user. Admin only."""
    if settings.specialist_invite_only and user_in.role in CLINICAL_ROLES:
        raise HTTPException(
            status_code=400,
            detail="Clinical specialist accounts must be onboarded via invite flow.",
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

    user = User(
        email=requested_email,
        password_hash=get_password_hash(user_in.password),
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
    db.commit()
    db.refresh(user)

    log_action(
        db,
        user_id=current_user.id,
        action="user_create",
        resource_type="user",
        resource_id=user.id,
        details=json.dumps({"after": _user_snapshot(user)}),
        ip_address=_client_ip(request),
    )

    return user


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
    if payload.role not in CLINICAL_ROLES:
        raise HTTPException(
            status_code=422,
            detail="Invite onboarding is restricted to clinical specialist roles in this phase.",
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
    invite_url = f"{settings.frontend_base_url.rstrip('/')}/invite/{raw_token}"

    log_action(
        db,
        user_id=current_user.id,
        action="user_invite",
        resource_type="user_invite",
        resource_id=invite.id,
        details=json.dumps({"email": payload.email, "role": payload.role.value}),
        ip_address=_client_ip(request),
    )

    return UserInviteCreateResponse(invite_url=invite_url, expires_at=invite.expires_at)


# ---------------------------------------------------------------------------
# READ ONE
# ---------------------------------------------------------------------------

@router.get("/{user_id}", response_model=UserOut)
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

@router.put("/{user_id}", response_model=UserOut)
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

    if user_in.email:
        normalized_email = user_in.email.lower()
        dup = db.scalar(
            select(User).where(
                User.email == normalized_email,
                User.deleted_at.is_(None),
            )
        )
        if dup and dup.id != user_id:
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
        user.password_hash = get_password_hash(update_data.pop("password"))
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
    log_action(
        db,
        user_id=current_user.id,
        action="user_update",
        resource_type="user",
        resource_id=user.id,
        details=json.dumps({"before": before, "after": after}),
        ip_address=_client_ip(request),
    )

    return user


# ---------------------------------------------------------------------------
# VERIFY  (admin-only)
# ---------------------------------------------------------------------------

@router.post("/{user_id}/verify", response_model=UserOut)
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
        details=json.dumps({"before": before_status, "after": "verified"}),
        ip_address=_client_ip(request),
    )

    return user


# ---------------------------------------------------------------------------
# DELETE  (admin-only, soft delete)
# ---------------------------------------------------------------------------

@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
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
        raise HTTPException(status_code=400, detail="Cannot delete yourself.")

    # Keep minimum active admin count.
    if (
        user.role == UserRole.admin
        and user.is_active
        and _active_admin_count_for_update(db) <= settings.min_active_admin_accounts
    ):
        raise HTTPException(
            status_code=400,
            detail=f"At least {settings.min_active_admin_accounts} active admin accounts are required.",
        )

    before = _user_snapshot(user)
    user.email = _retired_email(user.id)
    user.deleted_at = datetime.now(timezone.utc)
    user.is_active = False
    db.add(user)
    db.commit()

    log_action(
        db,
        user_id=current_user.id,
        action="user_delete",
        resource_type="user",
        resource_id=user.id,
        details=json.dumps({"before": before}),
        ip_address=_client_ip(request),
    )

    return None


# ---------------------------------------------------------------------------
# BULK DELETE  (admin-only, soft delete)
# ---------------------------------------------------------------------------

class BulkDeleteRequest(BaseModel):
    ids: List[str]


class BulkDeleteResponse(BaseModel):
    deleted: int
    skipped: List[str]


@router.post("/bulk-delete", response_model=BulkDeleteResponse)
def bulk_delete_users(
    *,
    request: Request,
    db: Session = Depends(auth_service.get_db),
    payload: BulkDeleteRequest,
    current_user: User = Depends(get_admin_user),
) -> Any:
    """Bulk soft-delete users. Admin only."""
    deleted = 0
    skipped: List[str] = []

    for uid_str in payload.ids:
        try:
            user_id = UUID(uid_str)
        except ValueError:
            skipped.append(f"{uid_str}: invalid ID")
            continue

        user = db.scalar(
            select(User).where(User.id == user_id, User.deleted_at.is_(None)).with_for_update()
        )
        if not user:
            skipped.append(f"{uid_str}: not found")
            continue

        if user.id == current_user.id:
            skipped.append(f"{uid_str}: cannot delete yourself")
            continue

        if user.role == UserRole.admin and user.is_active:
            if _active_admin_count_for_update(db) <= settings.min_active_admin_accounts:
                skipped.append(f"{uid_str}: minimum admin requirement")
                continue

        before = _user_snapshot(user)
        user.email = _retired_email(user.id)
        user.deleted_at = datetime.now(timezone.utc)
        user.is_active = False
        db.add(user)
        db.commit()

        log_action(
            db,
            user_id=current_user.id,
            action="user_delete",
            resource_type="user",
            resource_id=user.id,
            details=json.dumps({"before": before, "bulk": True}),
            ip_address=_client_ip(request),
        )
        deleted += 1

    return BulkDeleteResponse(deleted=deleted, skipped=skipped)
