import csv
import io
import json
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.limiter import limiter
from app.models.audit_log import AuditLog
from app.models.user import User
from app.schemas.audit import AuditLogListResponse, AuditLogResponse
from app.services.auth import get_admin_user, get_db

router = APIRouter(prefix="/audit", tags=["audit"])


def _failure_clause():
    return or_(
        AuditLog.action.ilike("%denied%"),
        AuditLog.action.ilike("%forbidden%"),
        AuditLog.action.ilike("%failed%"),
        AuditLog.details.ilike('%"success": false%'),
        AuditLog.details.ilike('%"error"%'),
    )


def _success_clause():
    return and_(
        ~AuditLog.action.ilike("%denied%"),
        ~AuditLog.action.ilike("%forbidden%"),
        ~AuditLog.action.ilike("%failed%"),
        or_(
            AuditLog.details.is_(None),
            ~AuditLog.details.ilike('%"success": false%'),
        ),
    )


def _normalize_date_to(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.hour == 0 and value.minute == 0 and value.second == 0 and value.microsecond == 0:
        return value + timedelta(days=1) - timedelta(microseconds=1)
    return value


def _build_query():
    return (
        select(
            AuditLog,
            User.email.label("user_email"),
            User.first_name.label("user_first_name"),
            User.last_name.label("user_last_name"),
        )
        .outerjoin(User, AuditLog.user_id == User.id)
    )


def _apply_filters(
    stmt,
    *,
    user_id: Optional[UUID],
    user_query: Optional[str],
    action: Optional[str],
    resource_type: Optional[str],
    is_break_glass: Optional[bool],
    date_from: Optional[datetime],
    date_to: Optional[datetime],
    search: Optional[str],
    result: Optional[str],
):
    if user_id:
        stmt = stmt.where(AuditLog.user_id == user_id)
    if user_query:
        pattern = f"%{user_query.strip()}%"
        stmt = stmt.where(
            or_(
                User.email.ilike(pattern),
                User.first_name.ilike(pattern),
                User.last_name.ilike(pattern),
            )
        )
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if resource_type:
        stmt = stmt.where(AuditLog.resource_type == resource_type)
    if is_break_glass is not None:
        stmt = stmt.where(AuditLog.is_break_glass == is_break_glass)
    if date_from:
        stmt = stmt.where(AuditLog.created_at >= date_from)
    normalized_date_to = _normalize_date_to(date_to)
    if normalized_date_to:
        stmt = stmt.where(AuditLog.created_at <= normalized_date_to)
    if search:
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                AuditLog.action.ilike(pattern),
                AuditLog.details.ilike(pattern),
                AuditLog.ip_address.ilike(pattern),
                User.email.ilike(pattern),
                User.first_name.ilike(pattern),
                User.last_name.ilike(pattern),
            )
        )
    if result == "failure":
        stmt = stmt.where(_failure_clause())
    elif result == "success":
        stmt = stmt.where(_success_clause())
    return stmt


def _derive_result(log: AuditLog) -> str:
    action = (log.action or "").lower()
    if "denied" in action or "forbidden" in action or "failed" in action:
        return "failure"

    if log.details:
        try:
            parsed = json.loads(log.details)
            if isinstance(parsed, dict):
                success = parsed.get("success")
                if success is True:
                    return "success"
                if success is False:
                    return "failure"
                if parsed.get("error"):
                    return "failure"
        except (TypeError, json.JSONDecodeError):
            details_lower = log.details.lower()
            if "denied" in details_lower or "forbidden" in details_lower or "error" in details_lower:
                return "failure"

    return "success"


@router.get("/logs", response_model=AuditLogListResponse)
@limiter.limit("30/minute")
def get_audit_logs(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    user_id: Optional[UUID] = None,
    user: Optional[str] = Query(default=None, min_length=1),
    action: Optional[str] = None,
    resource_type: Optional[str] = None,
    is_break_glass: Optional[bool] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    search: Optional[str] = None,
    result: Optional[str] = Query(default=None, pattern="^(success|failure)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    """View audit logs with filters (admin only)."""
    stmt = _apply_filters(
        _build_query(),
        user_id=user_id,
        user_query=user,
        action=action,
        resource_type=resource_type,
        is_break_glass=is_break_glass,
        date_from=date_from,
        date_to=date_to,
        search=search,
        result=result,
    )

    count_stmt = _apply_filters(
        select(func.count()).select_from(AuditLog).outerjoin(User, AuditLog.user_id == User.id),
        user_id=user_id,
        user_query=user,
        action=action,
        resource_type=resource_type,
        is_break_glass=is_break_glass,
        date_from=date_from,
        date_to=date_to,
        search=search,
        result=result,
    )

    total = db.scalar(count_stmt) or 0
    rows = db.execute(
        stmt.order_by(AuditLog.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    ).all()

    items = []
    for row in rows:
        log = row[0]
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
                result=_derive_result(log),
                resource_type=log.resource_type,
                resource_id=str(log.resource_id) if log.resource_id else None,
                details=log.details,
                ip_address=log.ip_address,
                is_break_glass=log.is_break_glass,
                break_glass_reason=log.break_glass_reason,
                old_values=log.old_values,
                new_values=log.new_values,
                created_at=log.created_at,
            )
        )

    return AuditLogListResponse(items=items, page=page, limit=limit, total=total)


@router.get("/export")
@limiter.limit("5/minute")
def export_audit_logs(
    request: Request,
    user_id: Optional[UUID] = None,
    user: Optional[str] = Query(default=None, min_length=1),
    action: Optional[str] = None,
    resource_type: Optional[str] = None,
    is_break_glass: Optional[bool] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    search: Optional[str] = None,
    result: Optional[str] = Query(default=None, pattern="^(success|failure)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    """Export audit logs to CSV (admin only)."""
    stmt = _apply_filters(
        _build_query(),
        user_id=user_id,
        user_query=user,
        action=action,
        resource_type=resource_type,
        is_break_glass=is_break_glass,
        date_from=date_from,
        date_to=date_to,
        search=search,
        result=result,
    ).order_by(AuditLog.created_at.desc()).limit(10000)

    rows = db.execute(stmt).all()

    def iter_file():
        output = io.StringIO()
        writer = csv.writer(output)

        writer.writerow(
            [
                "ID",
                "Date (UTC)",
                "User Name",
                "User Email",
                "Action",
                "Result",
                "Resource Type",
                "Resource ID",
                "IP Address",
                "Break Glass",
                "Break Glass Reason",
                "Details",
            ]
        )
        yield output.getvalue()
        output.seek(0)
        output.truncate(0)

        for row in rows:
            log = row[0]
            user_email = row[1] or ""
            user_first_name = row[2] or ""
            user_last_name = row[3] or ""
            user_name = f"{user_first_name} {user_last_name}".strip()

            writer.writerow(
                [
                    str(log.id),
                    log.created_at.isoformat() if log.created_at else "",
                    user_name,
                    user_email,
                    log.action,
                    _derive_result(log),
                    log.resource_type or "",
                    str(log.resource_id) if log.resource_id else "",
                    log.ip_address or "",
                    "Yes" if log.is_break_glass else "No",
                    log.break_glass_reason or "",
                    log.details or "",
                ]
            )
            yield output.getvalue()
            output.seek(0)
            output.truncate(0)

    filename = f"audit_logs_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter_file(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
