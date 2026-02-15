from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.ip_ban import IPBan
from app.models.login_attempt import LoginAttempt
from app.models.user import User
from app.services.auth import get_admin_user, get_db

router = APIRouter(prefix="/security", tags=["security"])
limiter = Limiter(key_func=get_remote_address)


# ── Schemas ──

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
    created_at: datetime


class LoginAttemptListResponse(BaseModel):
    items: list[LoginAttemptResponse]
    total: int


class SecurityStatsResponse(BaseModel):
    active_ip_bans: int
    failed_logins_24h: int
    locked_accounts: int
    total_attempts_24h: int


# ── Endpoints ──

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
            created_at=a.created_at,
        )
        for a in attempts
    ]

    return LoginAttemptListResponse(items=items, total=total)
