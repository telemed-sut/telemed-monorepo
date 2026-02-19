from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Any
from datetime import datetime, timedelta, timezone

from app.services.auth import get_db, get_admin_user
from app.models.device_error_log import DeviceErrorLog
from app.models.pressure_record import PressureRecord
from app.core.limiter import limiter

router = APIRouter()

@router.get("/device/v1/health")
@limiter.limit("60/minute")
def device_health_check(request: Request):
    """
    Simple health check for device connectivity.
    """
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}

@router.get("/device/v1/stats")
@limiter.limit("240/minute")
def get_device_stats(
    request: Request,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_admin_user),
    hours: int = Query(default=24, ge=1, le=168),
):
    """
    Get statistics for device usage in the last N hours.
    Requires Admin privileges.
    """
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    # Count successful records
    success_count = db.query(func.count(PressureRecord.id)).filter(
        PressureRecord.created_at >= since
    ).scalar()

    # Count errors
    error_count = db.query(func.count(DeviceErrorLog.id)).filter(
        DeviceErrorLog.occurred_at >= since
    ).scalar()

    # Group errors by device_id
    errors_by_device = db.query(
        DeviceErrorLog.device_id, func.count(DeviceErrorLog.id)
    ).filter(
        DeviceErrorLog.occurred_at >= since
    ).group_by(DeviceErrorLog.device_id).all()

    return {
        "period_hours": hours,
        "success_count": success_count,
        "error_count": error_count,
        "error_rate": (error_count / (success_count + error_count)) if (success_count + error_count) > 0 else 0,
        "errors_by_device": [{"device_id": d, "count": c} for d, c in errors_by_device]
    }

@router.get("/device/v1/errors")
@limiter.limit("240/minute")
def get_device_errors(
    request: Request,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_admin_user),
    limit: int = Query(default=50, ge=1, le=500),
    hours: int | None = Query(default=None, ge=1, le=168),
    since: datetime | None = None,
    device_id: str | None = Query(default=None, min_length=1, max_length=128),
):
    """
    Get latest device error logs.
    Requires Superuser privileges.
    """
    query = db.query(DeviceErrorLog)

    if device_id:
        query = query.filter(DeviceErrorLog.device_id == device_id.strip())

    now_utc = datetime.now(timezone.utc)
    if hours is not None:
        query = query.filter(DeviceErrorLog.occurred_at >= now_utc - timedelta(hours=hours))

    if since is not None:
        since_utc = since if since.tzinfo else since.replace(tzinfo=timezone.utc)
        query = query.filter(DeviceErrorLog.occurred_at > since_utc)

    errors = query.order_by(
        DeviceErrorLog.occurred_at.desc(),
        DeviceErrorLog.id.desc(),
    ).limit(limit).all()

    return errors
