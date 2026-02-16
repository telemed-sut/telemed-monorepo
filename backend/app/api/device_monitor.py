from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Any
from datetime import datetime, timedelta

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
    return {"status": "ok", "timestamp": datetime.now().isoformat()}

@router.get("/device/v1/stats")
def get_device_stats(
    request: Request,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_admin_user),
    hours: int = 24
):
    """
    Get statistics for device usage in the last N hours.
    Requires Admin privileges.
    """
    since = datetime.now() - timedelta(hours=hours)

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
def get_device_errors(
    request: Request,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_admin_user),
    limit: int = 50
):
    """
    Get latest device error logs.
    Requires Superuser privileges.
    """
    errors = db.query(DeviceErrorLog).order_by(
        DeviceErrorLog.occurred_at.desc()
    ).limit(limit).all()

    return errors
