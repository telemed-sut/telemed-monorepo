import logging
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, EmailStr, Field, model_validator
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.limiter import limiter
from app.core.security import generate_totp_secret, get_password_hash
from app.models.audit_log import AuditLog
from app.models.device_registration import DeviceRegistration
from app.models.enums import UserRole
from app.models.ip_ban import IPBan
from app.models.login_attempt import LoginAttempt
from app.models.user import User
from app.services import auth as auth_service
from app.services import security as security_service
from app.services.auth import get_admin_user, get_db

router = APIRouter(prefix="/security", tags=["security"])
settings = get_settings()
logger = logging.getLogger(__name__)


# Use shared utility for consistent IP extraction across all routes.
from app.core.request_utils import get_client_ip as _client_ip  # noqa: E402


def _write_unlock_audit(
    db: Session,
    *,
    actor: Optional[User],
    ip_address: str,
    success: bool,
    target_user: Optional[User],
    reason: Optional[str],
    authorized_by: str,
    message: str,
) -> None:
    details = {
        "success": success,
        "authorized_by": authorized_by,
        "message": message,
        "reason": reason or "",
    }
    if target_user:
        details["target_user_id"] = str(target_user.id)
        details["target_email"] = target_user.email
    if actor:
        details["actor_email"] = actor.email

    db.add(
        AuditLog(
            user_id=actor.id if actor else None,
            action="admin_emergency_unlock",
            resource_type="user",
            resource_id=target_user.id if target_user else None,
            details=details,
            ip_address=ip_address,
            is_break_glass=False,
            status="success" if success else "failure",
        )
    )
    db.commit()


# ── Schemas ──


class IPBanCreate(BaseModel):
    ip_address: str
    reason: str | None = None
    duration_minutes: int = 1440  # Default 24 hours


class IPBanResponse(BaseModel):
    id: str
    ip_address: str
    reason: str | None = None
    failed_attempts: int
    banned_until: datetime | None = None
    created_at: datetime



class IPBanListResponse(BaseModel):
    items: list[IPBanResponse]
    total: int


class LoginAttemptResponse(BaseModel):
    id: str
    ip_address: str
    email: str
    success: bool
    details: str | None = None
    created_at: datetime


class LoginAttemptListResponse(BaseModel):
    items: list[LoginAttemptResponse]
    total: int


class SecurityStatsResponse(BaseModel):
    active_ip_bans: int
    failed_logins_24h: int
    failed_logins_1h: int
    locked_accounts: int
    total_attempts_24h: int
    forbidden_403_1h: int
    forbidden_403_baseline_24h: int
    forbidden_403_spike: bool
    purge_actions_24h: int
    emergency_actions_24h: int


class AdminEmergencyUnlockRequest(BaseModel):
    email: EmailStr | None = None
    user_id: UUID | None = None
    reason: str | None = None

    @model_validator(mode="after")
    def validate_target(self):
        if not self.email and not self.user_id:
            raise ValueError("Either email or user_id is required.")
        return self


class AdminEmergencyUnlockResponse(BaseModel):
    message: str
    user_id: str
    email: str
    was_locked: bool


class AdminUserTwoFactorResetRequest(BaseModel):
    reason: str


class AdminUserTwoFactorResetResponse(BaseModel):
    message: str
    user_id: str
    email: str
    setup_required: bool


class AdminSecurityUserLookupResponse(BaseModel):
    user_id: str
    email: str
    role: str
    two_factor_enabled: bool
    is_locked: bool


class AdminUserPasswordResetRequest(BaseModel):
    reason: str


class AdminUserPasswordResetResponse(BaseModel):
    message: str
    user_id: str
    email: str
    reset_token: str
    reset_token_expires_in: int


class DeviceRegistrationView(BaseModel):
    id: str
    device_id: str
    display_name: str
    notes: str | None = None
    is_active: bool
    last_seen_at: datetime | None = None
    deactivated_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class DeviceRegistrationListResponse(BaseModel):
    items: list[DeviceRegistrationView]
    total: int
    page: int
    limit: int


class DeviceRegistrationCreateRequest(BaseModel):
    device_id: str = Field(..., min_length=1, max_length=128)
    display_name: str = Field(..., min_length=1, max_length=200)
    device_secret: str | None = None
    notes: str | None = Field(default=None, max_length=500)
    is_active: bool = True

    @model_validator(mode="after")
    def normalize_fields(self):
        self.device_id = self.device_id.strip()
        self.display_name = self.display_name.strip()
        self.notes = self.notes.strip() if self.notes else None
        if not self.device_id:
            raise ValueError("device_id must not be empty.")
        if not self.display_name:
            raise ValueError("display_name must not be empty.")
        return self


class DeviceRegistrationCreateResponse(BaseModel):
    device: DeviceRegistrationView
    device_secret: str


class DeviceRegistrationUpdateRequest(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    notes: str | None = Field(default=None, max_length=500)
    is_active: bool | None = None

    @model_validator(mode="after")
    def validate_payload(self):
        if self.display_name is None and self.notes is None and self.is_active is None:
            raise ValueError("At least one field must be provided.")
        if self.display_name is not None:
            self.display_name = self.display_name.strip()
            if not self.display_name:
                raise ValueError("display_name must not be empty.")
        if self.notes is not None:
            self.notes = self.notes.strip() or None
        return self


class DeviceRegistrationRotateSecretRequest(BaseModel):
    device_secret: str | None = None


class DeviceRegistrationRotateSecretResponse(BaseModel):
    message: str
    device_secret: str
    rotated_at: datetime


class DeviceRegistrationDeleteResponse(BaseModel):
    message: str
    device_id: str


DEVICE_SECRET_MIN_LENGTH = 32


def _normalize_device_secret(raw_secret: str | None) -> str:
    if raw_secret is None:
        return secrets.token_urlsafe(48)

    normalized = raw_secret.strip()
    if len(normalized) < DEVICE_SECRET_MIN_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"device_secret must be at least {DEVICE_SECRET_MIN_LENGTH} characters.",
        )
    return normalized


def _to_device_registration_view(device: DeviceRegistration) -> DeviceRegistrationView:
    return DeviceRegistrationView(
        id=str(device.id),
        device_id=device.device_id,
        display_name=device.display_name,
        notes=device.notes,
        is_active=bool(device.is_active),
        last_seen_at=device.last_seen_at,
        deactivated_at=device.deactivated_at,
        created_at=device.created_at,
        updated_at=device.updated_at,
    )


def _write_device_registry_audit(
    db: Session,
    *,
    actor: User,
    ip_address: str,
    action: str,
    device: DeviceRegistration,
    details: dict,
) -> None:
    db.add(
        AuditLog(
            user_id=actor.id,
            action=action,
            resource_type="device_registration",
            resource_id=device.id,
            details=details,
            ip_address=ip_address,
            is_break_glass=False,
            status="success",
        )
    )


# ── Endpoints ──


@router.post("/admin-unlock", response_model=AdminEmergencyUnlockResponse)
@limiter.limit("10/minute")
def emergency_unlock_admin(
    request: Request,
    payload: AdminEmergencyUnlockRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    ip = _client_ip(request)
    if not auth_service.is_super_admin(current_user):
        _write_unlock_audit(
            db,
            actor=current_user,
            ip_address=ip,
            success=False,
            target_user=None,
            reason=payload.reason,
            authorized_by="admin_not_super_admin",
            message="Unauthorized emergency admin unlock attempt (super admin required)",
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super admin only.",
        )

    if payload.user_id:
        target = db.scalar(
            select(User)
            .where(User.id == payload.user_id, User.deleted_at.is_(None))
            .with_for_update()
        )
    else:
        target = db.scalar(
            select(User)
            .where(User.email == payload.email.lower(), User.deleted_at.is_(None))
            .with_for_update()
        )

    if not target:
        _write_unlock_audit(
            db,
            actor=current_user,
            ip_address=ip,
            success=False,
            target_user=None,
            reason=payload.reason,
            authorized_by="super_admin",
            message="Target user not found for emergency unlock",
        )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if target.role != UserRole.admin:
        _write_unlock_audit(
            db,
            actor=current_user,
            ip_address=ip,
            success=False,
            target_user=target,
            reason=payload.reason,
            authorized_by="super_admin",
            message="Emergency unlock denied: target is not an admin account",
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Emergency unlock is only available for admin accounts.",
        )

    now = datetime.now(timezone.utc)
    locked_until = target.account_locked_until
    if locked_until and locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=timezone.utc)
    was_locked = bool((locked_until and locked_until > now) or (target.failed_login_attempts or 0) > 0)

    target.failed_login_attempts = 0
    target.account_locked_until = None
    target.last_failed_login_at = None
    db.add(target)
    db.flush()

    _write_unlock_audit(
        db,
        actor=current_user,
        ip_address=ip,
        success=True,
        target_user=target,
        reason=payload.reason,
        authorized_by="super_admin",
        message="Admin account emergency unlock completed",
    )

    logger.info(
        "Emergency unlock: target_user_id=%s was_locked=%s authorized_by=%s actor_id=%s",
        target.id,
        was_locked,
        "super_admin",
        current_user.id,
    )
    return AdminEmergencyUnlockResponse(
        message=f"Admin account {target.email} has been unlocked.",
        user_id=str(target.id),
        email=target.email,
        was_locked=was_locked,
    )


@router.get("/users/resolve", response_model=AdminSecurityUserLookupResponse)
@limiter.limit("30/minute")
def resolve_user_for_security_actions(
    request: Request,
    email: EmailStr,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    user = db.scalar(
        select(User).where(
            User.email == str(email).lower(),
            User.deleted_at.is_(None),
        )
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    now = datetime.now(timezone.utc)
    locked_until = user.account_locked_until
    if locked_until and locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=timezone.utc)

    return AdminSecurityUserLookupResponse(
        user_id=str(user.id),
        email=user.email,
        role=user.role.value if user.role else "unknown",
        two_factor_enabled=bool(user.two_factor_enabled),
        is_locked=bool(locked_until and locked_until > now),
    )


@router.post("/users/{user_id}/2fa/reset", response_model=AdminUserTwoFactorResetResponse)
@limiter.limit("10/minute")
def reset_user_two_factor_by_super_admin(
    request: Request,
    user_id: UUID,
    payload: AdminUserTwoFactorResetRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    ip = _client_ip(request)
    if not auth_service.is_super_admin(current_user):
        db.add(
            AuditLog(
                user_id=current_user.id,
                action="admin_force_2fa_reset_denied",
                resource_type="user",
                resource_id=user_id,
                details={"reason": payload.reason, "error": "not_super_admin"},
                ip_address=ip,
                is_break_glass=False,
                status="failure",
            )
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin only.")

    target = db.scalar(
        select(User)
        .where(User.id == user_id, User.deleted_at.is_(None))
        .with_for_update()
    )
    if not target:
        db.add(
            AuditLog(
                user_id=current_user.id,
                action="admin_force_2fa_reset_denied",
                resource_type="user",
                resource_id=user_id,
                details={"reason": payload.reason, "error": "target_not_found"},
                ip_address=ip,
                is_break_glass=False,
                status="failure",
            )
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    target.two_factor_secret = generate_totp_secret()
    target.two_factor_enabled = False
    target.two_factor_enabled_at = None
    revoked_devices = security_service.revoke_all_trusted_devices(db, user_id=target.id)
    revoked_backup_codes = security_service.revoke_backup_codes(db, user_id=target.id)
    db.add(target)
    db.add(
        AuditLog(
            user_id=current_user.id,
            action="admin_force_2fa_reset",
            resource_type="user",
            resource_id=target.id,
            details={
                "reason": payload.reason,
                "target_email": target.email,
                "revoked_devices": revoked_devices,
                "revoked_backup_codes": revoked_backup_codes,
            },
            ip_address=ip,
            is_break_glass=False,
            status="success",
        )
    )
    db.commit()
    return AdminUserTwoFactorResetResponse(
        message=f"2FA has been reset for {target.email}.",
        user_id=str(target.id),
        email=target.email,
        setup_required=True,
    )


@router.post("/users/{user_id}/password/reset", response_model=AdminUserPasswordResetResponse)
@limiter.limit("10/minute")
def reset_user_password_by_super_admin(
    request: Request,
    user_id: UUID,
    payload: AdminUserPasswordResetRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    ip = _client_ip(request)
    reason = payload.reason.strip()
    if len(reason) < 8:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Reason must be at least 8 characters.",
        )

    if not auth_service.is_super_admin(current_user):
        db.add(
            AuditLog(
                user_id=current_user.id,
                action="admin_force_password_reset_denied",
                resource_type="user",
                resource_id=user_id,
                details={"reason": reason, "error": "not_super_admin"},
                ip_address=ip,
                is_break_glass=False,
                status="failure",
            )
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin only.")

    target = db.scalar(
        select(User)
        .where(User.id == user_id, User.deleted_at.is_(None))
        .with_for_update()
    )
    if not target:
        db.add(
            AuditLog(
                user_id=current_user.id,
                action="admin_force_password_reset_denied",
                resource_type="user",
                resource_id=user_id,
                details={"reason": reason, "error": "target_not_found"},
                ip_address=ip,
                is_break_glass=False,
                status="failure",
            )
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Immediately invalidate old credentials, then issue a short-lived one-time reset token.
    target.password_hash = get_password_hash(generate_totp_secret(16))
    target.failed_login_attempts = 0
    target.account_locked_until = None
    target.last_failed_login_at = None
    reset_token = auth_service.create_password_reset_token(target)
    db.add(target)
    db.add(
        AuditLog(
            user_id=current_user.id,
            action="admin_force_password_reset",
            resource_type="user",
            resource_id=target.id,
            details={
                "reason": reason,
                "target_email": target.email,
                "reset_token_expires_in": settings.password_reset_expires_in,
            },
            ip_address=ip,
            is_break_glass=False,
            status="success",
        )
    )
    db.commit()

    return AdminUserPasswordResetResponse(
        message=f"Password has been reset for {target.email}.",
        user_id=str(target.id),
        email=target.email,
        reset_token=reset_token,
        reset_token_expires_in=settings.password_reset_expires_in,
    )


@router.get("/devices", response_model=DeviceRegistrationListResponse)
@limiter.limit("30/minute")
def list_registered_devices(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=200),
    q: str | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    normalized_page = max(1, int(page))
    normalized_limit = max(1, min(int(limit), 200))

    stmt = select(DeviceRegistration)
    count_stmt = select(func.count()).select_from(DeviceRegistration)

    keyword = q.strip() if q else ""
    if keyword:
        pattern = f"%{keyword}%"
        search_condition = or_(
            DeviceRegistration.device_id.ilike(pattern),
            DeviceRegistration.display_name.ilike(pattern),
        )
        stmt = stmt.where(search_condition)
        count_stmt = count_stmt.where(search_condition)

    if is_active is not None:
        active_filter = DeviceRegistration.is_active.is_(is_active)
        stmt = stmt.where(active_filter)
        count_stmt = count_stmt.where(active_filter)

    # nosemgrep: generic-sql-fastapi
    # SQLAlchemy binds the optional filters here; q/is_active are not interpolated into raw SQL strings.
    total = db.scalar(count_stmt) or 0
    # nosemgrep: generic-sql-fastapi
    # Pagination values are normalized to bounded ints before reaching the ORM query builder.
    rows = db.scalars(
        stmt.order_by(DeviceRegistration.created_at.desc())
        .offset((normalized_page - 1) * normalized_limit)
        .limit(normalized_limit)
    ).all()

    return DeviceRegistrationListResponse(
        items=[_to_device_registration_view(row) for row in rows],
        total=total,
        page=normalized_page,
        limit=normalized_limit,
    )


@router.post("/devices", response_model=DeviceRegistrationCreateResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
def create_registered_device(
    request: Request,
    payload: DeviceRegistrationCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    secret_value = _normalize_device_secret(payload.device_secret)
    now = datetime.now(timezone.utc)

    device = DeviceRegistration(
        device_id=payload.device_id,
        display_name=payload.display_name,
        device_secret=secret_value,
        notes=payload.notes,
        is_active=payload.is_active,
        deactivated_at=None if payload.is_active else now,
        created_by=current_user.id,
        updated_by=current_user.id,
    )
    db.add(device)

    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Device ID already exists.",
        )

    _write_device_registry_audit(
        db,
        actor=current_user,
        ip_address=_client_ip(request),
        action="device_registration_create",
        device=device,
        details={
            "device_id": payload.device_id,
            "display_name": payload.display_name,
            "is_active": payload.is_active,
        },
    )

    db.commit()
    db.refresh(device)

    return DeviceRegistrationCreateResponse(
        device=_to_device_registration_view(device),
        device_secret=secret_value,
    )


@router.patch("/devices/{device_id}", response_model=DeviceRegistrationView)
@limiter.limit("20/minute")
def update_registered_device(
    request: Request,
    device_id: str,
    payload: DeviceRegistrationUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    normalized_device_id = device_id.strip()
    if not normalized_device_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="device_id is required.")

    device = db.scalar(select(DeviceRegistration).where(DeviceRegistration.device_id == normalized_device_id))
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found.")

    now = datetime.now(timezone.utc)
    if payload.display_name is not None:
        device.display_name = payload.display_name
    if payload.notes is not None:
        device.notes = payload.notes
    if payload.is_active is not None:
        device.is_active = payload.is_active
        device.deactivated_at = None if payload.is_active else now

    device.updated_by = current_user.id
    db.add(device)

    _write_device_registry_audit(
        db,
        actor=current_user,
        ip_address=_client_ip(request),
        action="device_registration_update",
        device=device,
        details={
            "device_id": device.device_id,
            "display_name": device.display_name,
            "is_active": bool(device.is_active),
        },
    )

    db.commit()
    db.refresh(device)
    return _to_device_registration_view(device)


@router.delete("/devices/{device_id}", response_model=DeviceRegistrationDeleteResponse)
@limiter.limit("20/minute")
def delete_registered_device(
    request: Request,
    device_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    normalized_device_id = device_id.strip()
    if not normalized_device_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="device_id is required.")

    device = db.scalar(select(DeviceRegistration).where(DeviceRegistration.device_id == normalized_device_id))
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found.")

    deleted_device_id = device.device_id
    deleted_display_name = device.display_name
    deleted_is_active = bool(device.is_active)

    _write_device_registry_audit(
        db,
        actor=current_user,
        ip_address=_client_ip(request),
        action="device_registration_delete",
        device=device,
        details={
            "device_id": deleted_device_id,
            "display_name": deleted_display_name,
            "is_active": deleted_is_active,
        },
    )

    db.delete(device)
    db.commit()

    return DeviceRegistrationDeleteResponse(
        message=f"Device {deleted_device_id} deleted.",
        device_id=deleted_device_id,
    )


@router.post("/devices/{device_id}/rotate-secret", response_model=DeviceRegistrationRotateSecretResponse)
@limiter.limit("20/minute")
def rotate_registered_device_secret(
    request: Request,
    device_id: str,
    payload: DeviceRegistrationRotateSecretRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    normalized_device_id = device_id.strip()
    if not normalized_device_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="device_id is required.")

    device = db.scalar(select(DeviceRegistration).where(DeviceRegistration.device_id == normalized_device_id))
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found.")

    secret_value = _normalize_device_secret(payload.device_secret)
    now = datetime.now(timezone.utc)

    device.device_secret = secret_value
    device.updated_by = current_user.id
    db.add(device)

    _write_device_registry_audit(
        db,
        actor=current_user,
        ip_address=_client_ip(request),
        action="device_registration_rotate_secret",
        device=device,
        details={
            "device_id": device.device_id,
            "is_active": bool(device.is_active),
            "rotated_at": now.isoformat(),
        },
    )

    db.commit()
    db.refresh(device)
    return DeviceRegistrationRotateSecretResponse(
        message=f"Secret rotated for {device.device_id}.",
        device_secret=secret_value,
        rotated_at=now,
    )


@router.get("/stats", response_model=SecurityStatsResponse)
@limiter.limit("30/minute")
def get_security_stats(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    now = datetime.now(timezone.utc)
    day_ago = now.replace(hour=0, minute=0, second=0, microsecond=0)
    hour_ago = now - timedelta(hours=1)

    active_bans = db.scalar(
        select(func.count()).select_from(IPBan).where(
            (IPBan.banned_until.is_(None)) | (IPBan.banned_until > now)
        )
    ) or 0

    failed_24h = db.scalar(
        select(func.count()).select_from(LoginAttempt).where(
            LoginAttempt.success == False,  # noqa: E712
            LoginAttempt.created_at >= day_ago,
        )
    ) or 0

    failed_1h = db.scalar(
        select(func.count()).select_from(LoginAttempt).where(
            LoginAttempt.success == False,  # noqa: E712
            LoginAttempt.created_at >= hour_ago,
        )
    ) or 0

    locked_accounts = db.scalar(
        select(func.count()).select_from(User).where(
            User.account_locked_until.isnot(None),
            User.account_locked_until > now,
            User.deleted_at.is_(None),
        )
    ) or 0

    total_24h = db.scalar(
        select(func.count()).select_from(LoginAttempt).where(
            LoginAttempt.created_at >= day_ago,
        )
    ) or 0

    forbidden_403_1h = db.scalar(
        select(func.count()).select_from(AuditLog).where(
            AuditLog.action == "http_403_denied",
            AuditLog.created_at >= hour_ago,
        )
    ) or 0

    forbidden_403_baseline_24h = db.scalar(
        select(func.count()).select_from(AuditLog).where(
            AuditLog.action == "http_403_denied",
            AuditLog.created_at >= day_ago,
        )
    ) or 0

    purge_actions_24h = db.scalar(
        select(func.count()).select_from(AuditLog).where(
            AuditLog.action == "user_purge_deleted_summary",
            AuditLog.created_at >= day_ago,
        )
    ) or 0

    emergency_actions_24h = db.scalar(
        select(func.count()).select_from(AuditLog).where(
            AuditLog.action.in_(
                (
                    "admin_emergency_unlock",
                    "admin_force_2fa_reset",
                    "admin_force_password_reset",
                )
            ),
            AuditLog.created_at >= day_ago,
        )
    ) or 0

    forbidden_403_spike = forbidden_403_1h >= settings.security_403_spike_threshold_1h

    return SecurityStatsResponse(
        active_ip_bans=active_bans,
        failed_logins_24h=failed_24h,
        failed_logins_1h=failed_1h,
        locked_accounts=locked_accounts,
        total_attempts_24h=total_24h,
        forbidden_403_1h=forbidden_403_1h,
        forbidden_403_baseline_24h=forbidden_403_baseline_24h,
        forbidden_403_spike=forbidden_403_spike,
        purge_actions_24h=purge_actions_24h,
        emergency_actions_24h=emergency_actions_24h,
    )


@router.get("/ip-bans", response_model=IPBanListResponse)
@limiter.limit("30/minute")
def get_ip_bans(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    now = datetime.now(timezone.utc)

    count_stmt = select(func.count()).select_from(IPBan).where(
        (IPBan.banned_until.is_(None)) | (IPBan.banned_until > now)
    )
    total = db.scalar(count_stmt) or 0

    stmt = (
        select(IPBan)
        .where((IPBan.banned_until.is_(None)) | (IPBan.banned_until > now))
        .order_by(IPBan.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    )
    bans = db.scalars(stmt).all()

    items = [
        IPBanResponse(
            id=str(ban.id),
            ip_address=ban.ip_address,
            reason=ban.reason,
            failed_attempts=ban.failed_attempts,
            banned_until=ban.banned_until,
            created_at=ban.created_at,
        )
        for ban in bans
    ]

    return IPBanListResponse(items=items, total=total)


@router.post("/ip-bans", response_model=IPBanResponse)
@limiter.limit("20/minute")
def create_ip_ban(
    request: Request,
    payload: IPBanCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    # Prevent banning own IP
    client_ip = _client_ip(request)
    
    if payload.ip_address == client_ip:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot ban your own IP address."
        )

    # Check if already banned
    existing_ban = db.scalar(select(IPBan).where(IPBan.ip_address == payload.ip_address))
    was_existing = existing_ban is not None
    if existing_ban:
        # Update existing ban
        existing_ban.reason = payload.reason or existing_ban.reason
        existing_ban.banned_until = datetime.now(timezone.utc) + timedelta(minutes=payload.duration_minutes)
        db.add(existing_ban)
        db.commit()
        db.refresh(existing_ban)
        ban = existing_ban
    else:
        # Create new ban
        ban = IPBan(
            ip_address=payload.ip_address,
            reason=payload.reason or "Manual ban by admin",
            failed_attempts=0,
            banned_until=datetime.now(timezone.utc) + timedelta(minutes=payload.duration_minutes),
        )
        db.add(ban)
        db.commit()
        db.refresh(ban)

    db.add(
        AuditLog(
            user_id=current_user.id,
            action="ip_ban_create",
            resource_type="ip_ban",
            details={
                "ip_address": ban.ip_address,
                "duration_minutes": payload.duration_minutes,
                "reason": payload.reason or "Manual ban by admin",
                "updated_existing": was_existing,
            },
            ip_address=client_ip,
            is_break_glass=False,
            status="success",
        )
    )
    db.commit()

    return IPBanResponse(
        id=str(ban.id),
        ip_address=ban.ip_address,
        reason=ban.reason,
        failed_attempts=ban.failed_attempts,
        banned_until=ban.banned_until,
        created_at=ban.created_at,
    )

@router.delete("/ip-bans/{ip_address}")
@limiter.limit("20/minute")
def unban_ip(
    request: Request,
    ip_address: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    ban = db.scalar(select(IPBan).where(IPBan.ip_address == ip_address))
    if not ban:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="IP ban not found")

    actor_ip = _client_ip(request)
    db.add(
        AuditLog(
            user_id=current_user.id,
            action="ip_ban_delete",
            resource_type="ip_ban",
            details={"ip_address": ip_address},
            ip_address=actor_ip,
            is_break_glass=False,
            status="success",
        )
    )
    db.delete(ban)
    db.commit()
    logger.info("IP unbanned: %s actor_id=%s", ip_address, current_user.id)
    return {"message": f"IP {ip_address} has been unbanned"}


@router.get("/login-attempts", response_model=LoginAttemptListResponse)
@limiter.limit("30/minute")
def get_login_attempts(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    ip_address: Optional[str] = None,
    email: Optional[str] = None,
    success: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    stmt = select(LoginAttempt)
    count_stmt = select(func.count()).select_from(LoginAttempt)

    if ip_address:
        stmt = stmt.where(LoginAttempt.ip_address == ip_address)
        count_stmt = count_stmt.where(LoginAttempt.ip_address == ip_address)
    if email:
        stmt = stmt.where(LoginAttempt.email.ilike(f"%{email}%"))
        count_stmt = count_stmt.where(LoginAttempt.email.ilike(f"%{email}%"))
    if success is not None:
        stmt = stmt.where(LoginAttempt.success == success)
        count_stmt = count_stmt.where(LoginAttempt.success == success)

    total = db.scalar(count_stmt) or 0

    stmt = stmt.order_by(LoginAttempt.created_at.desc()).offset((page - 1) * limit).limit(limit)
    attempts = db.scalars(stmt).all()

    items = [
        LoginAttemptResponse(
            id=str(a.id),
            ip_address=a.ip_address,
            email=a.email,
            success=a.success,
            details=a.details,
            created_at=a.created_at,
        )
        for a in attempts
    ]

    return LoginAttemptListResponse(items=items, total=total)
