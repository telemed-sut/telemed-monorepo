import json
from datetime import datetime, timezone, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, EmailStr, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.limiter import limiter
from app.core.security import generate_totp_secret
from app.models.audit_log import AuditLog
from app.models.enums import UserRole
from app.models.ip_ban import IPBan
from app.models.login_attempt import LoginAttempt
from app.models.user import User
from app.services import auth as auth_service
from app.services import security as security_service
from app.services.auth import get_admin_user, get_db

router = APIRouter(prefix="/security", tags=["security"])


def _client_ip(request: Request) -> str:
    ip = request.headers.get("cf-connecting-ip")
    if ip:
        return ip
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


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
            details=json.dumps(details),
            ip_address=ip_address,
            is_break_glass=False,
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
    locked_accounts: int
    total_attempts_24h: int


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


# ── Endpoints ──


@router.post("/admin-unlock", response_model=AdminEmergencyUnlockResponse)
@limiter.limit("10/minute")
def emergency_unlock_admin(
    request: Request,
    payload: AdminEmergencyUnlockRequest,
    db: Session = Depends(get_db),
    optional_user: Optional[User] = Depends(auth_service.get_optional_current_user),
):
    ip = _client_ip(request)
    authorized_by_super_admin = auth_service.is_super_admin(optional_user)
    authorized_by_ip = security_service.is_admin_unlock_ip_whitelisted(ip)

    if not authorized_by_super_admin and not authorized_by_ip:
        _write_unlock_audit(
            db,
            actor=optional_user,
            ip_address=ip,
            success=False,
            target_user=None,
            reason=payload.reason,
            authorized_by="none",
            message="Unauthorized emergency admin unlock attempt",
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Emergency unlock is restricted to super admin or whitelisted IP.",
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
            actor=optional_user,
            ip_address=ip,
            success=False,
            target_user=None,
            reason=payload.reason,
            authorized_by="super_admin" if authorized_by_super_admin else "whitelisted_ip",
            message="Target user not found for emergency unlock",
        )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if target.role != UserRole.admin:
        _write_unlock_audit(
            db,
            actor=optional_user,
            ip_address=ip,
            success=False,
            target_user=target,
            reason=payload.reason,
            authorized_by="super_admin" if authorized_by_super_admin else "whitelisted_ip",
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
        actor=optional_user,
        ip_address=ip,
        success=True,
        target_user=target,
        reason=payload.reason,
        authorized_by="super_admin" if authorized_by_super_admin else "whitelisted_ip",
        message="Admin account emergency unlock completed",
    )

    return AdminEmergencyUnlockResponse(
        message=f"Admin account {target.email} has been unlocked.",
        user_id=str(target.id),
        email=target.email,
        was_locked=was_locked,
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
                details=json.dumps({"reason": payload.reason, "error": "not_super_admin"}),
                ip_address=ip,
                is_break_glass=False,
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
                details=json.dumps({"reason": payload.reason, "error": "target_not_found"}),
                ip_address=ip,
                is_break_glass=False,
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
            details=json.dumps(
                {
                    "reason": payload.reason,
                    "target_email": target.email,
                    "revoked_devices": revoked_devices,
                    "revoked_backup_codes": revoked_backup_codes,
                }
            ),
            ip_address=ip,
            is_break_glass=False,
        )
    )
    db.commit()
    return AdminUserTwoFactorResetResponse(
        message=f"2FA has been reset for {target.email}.",
        user_id=str(target.id),
        email=target.email,
        setup_required=True,
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

    return SecurityStatsResponse(
        active_ip_bans=active_bans,
        failed_logins_24h=failed_24h,
        locked_accounts=locked_accounts,
        total_attempts_24h=total_24h,
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
    client_ip = request.headers.get("cf-connecting-ip")
    if not client_ip:
        client_ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "unknown")
    
    if payload.ip_address == client_ip:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot ban your own IP address."
        )

    # Check if already banned
    existing_ban = db.scalar(select(IPBan).where(IPBan.ip_address == payload.ip_address))
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

    db.delete(ban)
    db.commit()
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
