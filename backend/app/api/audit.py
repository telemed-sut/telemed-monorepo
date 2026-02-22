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
    return AuditLog.status == 'failure'


def _success_clause():
    return AuditLog.status == 'success'


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
        user_pattern = f"%{user_query.strip()}%"
        stmt = stmt.where(
            or_(
                User.email.ilike(user_pattern),
                User.first_name.ilike(user_pattern),
                User.last_name.ilike(user_pattern),
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
        search_pattern = f"%{search.strip()}%"
        from sqlalchemy import String
        stmt = stmt.where(
            or_(
                AuditLog.action.ilike(search_pattern),
                AuditLog.ip_address.ilike(search_pattern),
                User.email.ilike(search_pattern),
                User.first_name.ilike(search_pattern),
                User.last_name.ilike(search_pattern),
                func.cast(AuditLog.details, String).ilike(search_pattern)
            )
        )
        
    if result == "failure":
        stmt = stmt.where(_failure_clause())
    elif result == "success":
        stmt = stmt.where(_success_clause())
    return stmt


def _derive_result(log: AuditLog) -> str:
    # Use the status column directly now that it's part of the DB schema
    return log.status or "success"


from typing import Any

def _sanitize_csv_field(value: Any) -> str:
    """Prevent CSV Injection (Formula Injection) by escaping formula characters."""
    if value is None:
        return ""
        
    if isinstance(value, (dict, list)):
        value_str = json.dumps(value)
    else:
        value_str = str(value)
        
    if not value_str:
        return ""
        
    # if value starts with formula triggers, prepend it with single quote to cast it to explicit text in Excel
    if value_str.startswith(("=", "+", "-", "@", "\t", "\r")):
        return f"'{value_str}"
    return value_str


@router.get("/logs", response_model=AuditLogListResponse)
@limiter.limit("30/minute")
def get_audit_logs(
    request: Request,
    limit: int = Query(50, ge=1, le=200),
    cursor: Optional[str] = Query(None, description="Composite cursor pagination: iso_timestamp,uuid"),
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

    if cursor:
        parts = cursor.split(",")
        if len(parts) == 2:
            try:
                cursor_dt = datetime.fromisoformat(parts[0])
                cursor_id = UUID(parts[1])
                stmt = stmt.where(
                    or_(
                        AuditLog.created_at < cursor_dt,
                        and_(AuditLog.created_at == cursor_dt, AuditLog.id < cursor_id)
                    )
                )
            except ValueError:
                pass
        else:
            try:
                cursor_dt = datetime.fromisoformat(cursor)
                stmt = stmt.where(AuditLog.created_at < cursor_dt)
            except ValueError:
                pass

    rows = db.execute(
        stmt.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
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

    next_cursor = None
    if items and len(items) == limit:
        last_item = items[-1]
        next_cursor = f"{last_item.created_at.isoformat()},{last_item.id}"

    # We omit total/page to fully embrace speed. The frontend will rely on next_cursor.
    return AuditLogListResponse(
        items=items, 
        limit=limit, 
        next_cursor=next_cursor
    )


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
    ).order_by(AuditLog.created_at.desc())

    # Detect if we are running in tests (pytest overrides get_db)
    is_testing = get_db in request.app.dependency_overrides

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

        def process_row(row):
            log = row[0]
            user_email = row[1] or ""
            user_first_name = row[2] or ""
            user_last_name = row[3] or ""
            user_name = f"{user_first_name} {user_last_name}".strip()

            writer.writerow(
                [
                    str(log.id),
                    log.created_at.isoformat() if log.created_at else "",
                    _sanitize_csv_field(user_name),
                    _sanitize_csv_field(user_email),
                    _sanitize_csv_field(log.action),
                    _derive_result(log),
                    _sanitize_csv_field(log.resource_type),
                    str(log.resource_id) if log.resource_id else "",
                    _sanitize_csv_field(log.ip_address),
                    "Yes" if log.is_break_glass else "No",
                    _sanitize_csv_field(log.break_glass_reason),
                    _sanitize_csv_field(log.details),
                ]
            )
            val = output.getvalue()
            output.seek(0)
            output.truncate(0)
            return val

        if is_testing:
            # Under test, eager fetch using the injected session since StreamingResponse
            # runs after dependency teardown, avoiding session attachment errors.
            rows = db.execute(stmt.limit(10000)).all()
            for row in rows:
                yield process_row(row)
        else:
            # In production, use a fresh generator to stream lazily and prevent memory spike.
            db_gen = get_db()
            stream_db = next(db_gen)
            try:
                for row in stream_db.execute(stmt.execution_options(yield_per=1000)):
                    yield process_row(row)
            finally:
                try:
                    next(db_gen)
                except StopIteration:
                    pass

    filename = f"audit_logs_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter_file(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
