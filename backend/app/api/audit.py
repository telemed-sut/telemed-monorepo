from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.user import User
from app.schemas.audit import AuditLogListResponse, AuditLogResponse
from app.services.auth import get_admin_user, get_db

router = APIRouter(prefix="/audit", tags=["audit"])
limiter = Limiter(key_func=get_remote_address)


@router.get("/logs", response_model=AuditLogListResponse)
@limiter.limit("30/minute")
def get_audit_logs(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    user_id: Optional[UUID] = None,
    action: Optional[str] = None,
    resource_type: Optional[str] = None,
    is_break_glass: Optional[bool] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    """View audit logs with filters (admin only)."""
    # Base query with LEFT JOIN on User to get user info
    stmt = (
        select(
            AuditLog,
            User.email.label("user_email"),
            User.first_name.label("user_first_name"),
            User.last_name.label("user_last_name"),
        )
        .outerjoin(User, AuditLog.user_id == User.id)
    )

    count_stmt = select(func.count()).select_from(AuditLog)

    # Apply filters
    if user_id:
        stmt = stmt.where(AuditLog.user_id == user_id)
        count_stmt = count_stmt.where(AuditLog.user_id == user_id)
    if action:
        stmt = stmt.where(AuditLog.action == action)
        count_stmt = count_stmt.where(AuditLog.action == action)
    if resource_type:
        stmt = stmt.where(AuditLog.resource_type == resource_type)
        count_stmt = count_stmt.where(AuditLog.resource_type == resource_type)
    if is_break_glass is not None:
        stmt = stmt.where(AuditLog.is_break_glass == is_break_glass)
        count_stmt = count_stmt.where(AuditLog.is_break_glass == is_break_glass)
    if date_from:
        stmt = stmt.where(AuditLog.created_at >= date_from)
        count_stmt = count_stmt.where(AuditLog.created_at >= date_from)
    if date_to:
        stmt = stmt.where(AuditLog.created_at <= date_to)
        count_stmt = count_stmt.where(AuditLog.created_at <= date_to)
    if search:
        search_filter = or_(
            AuditLog.action.ilike(f"%{search}%"),
            AuditLog.details.ilike(f"%{search}%"),
            AuditLog.ip_address.ilike(f"%{search}%"),
        )
        stmt = stmt.where(search_filter)
        count_stmt = count_stmt.outerjoin(User, AuditLog.user_id == User.id)
        count_stmt = count_stmt.where(search_filter)

    total = db.scalar(count_stmt) or 0
    stmt = stmt.order_by(AuditLog.created_at.desc()).offset((page - 1) * limit).limit(limit)
    rows = db.execute(stmt).all()

    items = []
    for row in rows:
        log = row[0]  # AuditLog object
        user_email = row[1]
        user_first_name = row[2]
        user_last_name = row[3]

        user_name = None
        if user_first_name or user_last_name:
            user_name = " ".join(filter(None, [user_first_name, user_last_name]))

        items.append(
            AuditLogResponse(
                id=str(log.id),
                user_id=str(log.user_id) if log.user_id else None,
                user_email=user_email,
                user_name=user_name,
                action=log.action,
                resource_type=log.resource_type,
                resource_id=str(log.resource_id) if log.resource_id else None,
                details=log.details,
                ip_address=log.ip_address,
                is_break_glass=log.is_break_glass,
                break_glass_reason=log.break_glass_reason,
                created_at=log.created_at,
            )
        )

    return AuditLogListResponse(items=items, page=page, limit=limit, total=total)
