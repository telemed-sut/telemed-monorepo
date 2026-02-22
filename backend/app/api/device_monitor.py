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
MAX_LOOKBACK_HOURS = 24 * 90

AUTH_ERROR_HINTS = {
    "missing_required_headers": "Send X-Device-Id, X-Timestamp, and X-Signature headers.",
    "invalid_device_id": "Set a non-empty device_id in payload and X-Device-Id header.",
    "empty_signature": "Set a valid lowercase hex signature in X-Signature.",
    "invalid_signature_length": "X-Signature must be a 64-char SHA256 hex string.",
    "invalid_signature": "Verify HMAC secret and signing message format.",
    "invalid_body_hash": "Hash the exact raw JSON bytes you send and set X-Body-Hash.",
    "missing_body_hash": "Set X-Body-Hash when body-hash signature mode is enabled.",
    "missing_nonce": "Set X-Nonce when nonce replay protection is enabled.",
    "invalid_nonce": "Use nonce length between 8 and 128 characters.",
    "replay_nonce": "Nonce already used. Generate a new nonce for every request.",
    "invalid_timestamp_format": "Set X-Timestamp as Unix seconds, for example 1760000000.",
    "timestamp_out_of_window": "Sync device clock to UTC. Allowed skew is about +/-5 minutes.",
    "missing_body": "Send a JSON body with required measurement fields.",
    "invalid_json": "Body must be valid JSON.",
    "device_id_mismatch": "Make payload.device_id match X-Device-Id exactly.",
    "unregistered_device": "Register device_id in DEVICE_API_SECRETS on backend.",
    "missing_device_secret": "Configure DEVICE_API_SECRET or DEVICE_API_SECRETS.",
    "body_too_large": "Reduce payload size (wave arrays) to fit backend size limits.",
}

HTTP_STATUS_HINTS = {
    "404": "user_id not found. Make sure patient exists before sending measurements.",
    "400": "Payload violated business/data constraints. Check values and formats.",
    "409": "Duplicate request. Ensure unique device_id + measured_at for each measurement.",
    "500": "Server internal error. Check backend logs and database connectivity.",
}


def _extract_error_code(error_message: str | None) -> str:
    message = (error_message or "").strip()
    if not message:
        return "unknown_error"

    lower_message = message.lower()
    if lower_message == "invalid signature":
        return "invalid_signature"

    if message.startswith("AUTH_FAILED:"):
        code = message.split("AUTH_FAILED:", 1)[1].strip()
        return code or "auth_failed"

    if message.startswith("VALIDATION_FAILED:"):
        return "validation_failed"

    if message.startswith("HTTP "):
        prefix = message.split(":", 1)[0].strip()
        status_code = prefix.replace("HTTP", "").strip()
        return f"http_{status_code}" if status_code else "http_error"

    if message.startswith("Internal Error"):
        return "internal_error"

    return "other_error"


def _hint_for_error_code(error_code: str) -> str:
    if error_code in AUTH_ERROR_HINTS:
        return AUTH_ERROR_HINTS[error_code]

    if error_code.startswith("http_"):
        http_code = error_code.split("_", 1)[1]
        return HTTP_STATUS_HINTS.get(http_code, "Check backend response detail for HTTP error context.")

    if error_code == "validation_failed":
        return "Request body failed schema validation. Check field names, data types, and value ranges."
    if error_code == "internal_error":
        return "Unexpected backend exception. Check backend logs for stack trace."
    if error_code == "other_error":
        return "Unknown error format. Check raw error_message and server logs."
    if error_code == "unknown_error":
        return "Missing error details. Check device and API gateway logs."

    return "Check raw error_message and backend logs for root cause."


def _serialize_device_error(error: DeviceErrorLog) -> dict[str, Any]:
    error_code = _extract_error_code(error.error_message)
    return {
        "id": error.id,
        "device_id": error.device_id,
        "error_message": error.error_message,
        "ip_address": error.ip_address,
        "endpoint": error.endpoint,
        "occurred_at": error.occurred_at,
        "error_code": error_code,
        "suggestion": _hint_for_error_code(error_code),
    }


def _to_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _resolve_window(
    hours: int | None,
    date_from: datetime | None,
    date_to: datetime | None,
) -> tuple[datetime, datetime]:
    now_utc = datetime.now(timezone.utc)
    end_at = _to_utc(date_to) if date_to is not None else now_utc

    if date_from is not None:
        start_at = _to_utc(date_from)
    else:
        lookback_hours = hours if hours is not None else 24
        start_at = end_at - timedelta(hours=lookback_hours)

    if start_at > end_at:
        start_at, end_at = end_at, start_at

    return start_at, end_at

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
    hours: int = Query(default=24, ge=1, le=MAX_LOOKBACK_HOURS),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    top_devices: int = Query(default=20, ge=1, le=100),
):
    """
    Get statistics for device usage in the last N hours.
    Requires Admin privileges.
    """
    start_at, end_at = _resolve_window(hours, date_from, date_to)

    # Count successful records
    success_count = db.query(func.count(PressureRecord.id)).filter(
        PressureRecord.created_at >= start_at,
        PressureRecord.created_at <= end_at,
    ).scalar()

    # Count errors
    error_count = db.query(func.count(DeviceErrorLog.id)).filter(
        DeviceErrorLog.occurred_at >= start_at,
        DeviceErrorLog.occurred_at <= end_at,
    ).scalar()

    # Group errors by device_id
    errors_by_device = db.query(
        DeviceErrorLog.device_id, func.count(DeviceErrorLog.id)
    ).filter(
        DeviceErrorLog.occurred_at >= start_at,
        DeviceErrorLog.occurred_at <= end_at,
    ).group_by(
        DeviceErrorLog.device_id
    ).order_by(
        func.count(DeviceErrorLog.id).desc()
    ).limit(top_devices).all()

    return {
        "period_hours": max(1, int((end_at - start_at).total_seconds() // 3600)),
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
    hours: int | None = Query(default=None, ge=1, le=MAX_LOOKBACK_HOURS),
    since: datetime | None = None,
    until: datetime | None = None,
    since_id: int | None = Query(default=None, ge=1),
    device_id: str | None = Query(default=None, min_length=1, max_length=128),
):
    """
    Get latest device error logs.
    Requires Superuser privileges.
    """
    query = db.query(DeviceErrorLog)

    if device_id:
        query = query.filter(DeviceErrorLog.device_id == device_id.strip())

    if hours is not None:
        query = query.filter(DeviceErrorLog.occurred_at >= datetime.now(timezone.utc) - timedelta(hours=hours))

    if since is not None:
        since_utc = _to_utc(since)
        query = query.filter(DeviceErrorLog.occurred_at > since_utc)

    if until is not None:
        until_utc = _to_utc(until)
        query = query.filter(DeviceErrorLog.occurred_at <= until_utc)

    if since_id is not None:
        query = query.filter(DeviceErrorLog.id > since_id)

    errors = query.order_by(
        DeviceErrorLog.occurred_at.desc(),
        DeviceErrorLog.id.desc(),
    ).limit(limit).all()

    return [_serialize_device_error(error) for error in errors]
