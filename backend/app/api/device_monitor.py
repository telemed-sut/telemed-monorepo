from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Any
import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from app.services.auth import get_current_user, get_db, get_admin_user
from app.models.device_exam_session import DeviceExamSession
from app.models.device_error_log import DeviceErrorLog
from app.models.device_registration import DeviceRegistration
from app.models.doctor_patient_assignment import DoctorPatientAssignment
from app.models.enums import (
    DeviceExamSessionResolutionReason,
    DeviceExamSessionStatus,
    DeviceMeasurementRoutingStatus,
    UserRole,
)
from app.models.patient import Patient
from app.models.pressure_record import PressureRecord
from app.models.lung_sound_record import LungSoundRecord
from app.core.limiter import limiter
from app.schemas.device_exam_session import DeviceExamSessionLiveBoardResponse
from app.schemas.device_exam_session import DeviceInventoryResponse
from app.schemas.lung_sound import (
    LungSoundReviewQueueItem,
    LungSoundReviewQueueResponse,
    LungSoundReviewResolveRequest,
)
from app.services import audit as audit_service

router = APIRouter()
MAX_LOOKBACK_HOURS = 24 * 90
MAX_STALE_AFTER_SECONDS = 60 * 60
DEFAULT_STALE_AFTER_SECONDS = 120
OPEN_SESSION_STATUSES = (
    DeviceExamSessionStatus.active,
    DeviceExamSessionStatus.stale,
)
logger = logging.getLogger(__name__)

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


def _full_patient_name(patient: Patient) -> str:
    parts = [patient.first_name.strip(), patient.last_name.strip()]
    return " ".join(part for part in parts if part).strip() or str(patient.id)


def _serialize_lung_sound_review_item(row: tuple[LungSoundRecord, DeviceExamSession | None, Patient | None]) -> LungSoundReviewQueueItem:
    record, session, patient = row
    return LungSoundReviewQueueItem(
        record_id=record.id,
        device_id=record.device_id,
        routing_status=record.routing_status,
        position=record.position,
        recorded_at=record.recorded_at,
        server_received_at=record.server_received_at,
        patient_id=record.patient_id,
        patient_name=_full_patient_name(patient) if patient else None,
        device_exam_session_id=record.device_exam_session_id,
        session_status=session.status if session else None,
        conflict_metadata=record.conflict_metadata,
    )


def _seconds_since(value: datetime | None, *, now_utc: datetime) -> int | None:
    if value is None:
        return None
    normalized = _to_utc(value)
    return max(0, int((now_utc - normalized).total_seconds()))


def _freshness_status(*, last_seen_at: datetime | None, stale_after_seconds: int, now_utc: datetime) -> str:
    seconds = _seconds_since(last_seen_at, now_utc=now_utc)
    if seconds is None:
        return "unknown"
    return "stale" if seconds > stale_after_seconds else "fresh"


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


@router.get("/device/v1/live-sessions", response_model=DeviceExamSessionLiveBoardResponse)
@limiter.limit("120/minute")
def get_live_device_sessions(
    request: Request,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
    include_pending: bool = Query(default=False),
    stale_after_seconds: int = Query(default=DEFAULT_STALE_AFTER_SECONDS, ge=10, le=MAX_STALE_AFTER_SECONDS),
    device_id: str | None = Query(default=None, min_length=1, max_length=128),
):
    if current_user.role not in (UserRole.admin, UserRole.doctor, UserRole.medical_student):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Required roles: ['admin', 'doctor', 'medical_student']",
        )

    statuses = [*OPEN_SESSION_STATUSES]
    if include_pending:
        statuses.append(DeviceExamSessionStatus.pending_pair)

    query = (
        db.query(DeviceExamSession, DeviceRegistration, Patient)
        .join(Patient, Patient.id == DeviceExamSession.patient_id)
        .outerjoin(DeviceRegistration, DeviceRegistration.device_id == DeviceExamSession.device_id)
        .filter(
            DeviceExamSession.status.in_(statuses),
            Patient.deleted_at.is_(None),
            Patient.is_active == True,  # noqa: E712
        )
    )

    if device_id:
        query = query.filter(DeviceExamSession.device_id == device_id.strip())

    if current_user.role in (UserRole.doctor, UserRole.medical_student):
        query = query.join(
            DoctorPatientAssignment,
            DoctorPatientAssignment.patient_id == DeviceExamSession.patient_id,
        ).filter(DoctorPatientAssignment.doctor_id == current_user.id)

    rows = (
        query.order_by(
            DeviceExamSession.status.asc(),
            DeviceExamSession.last_seen_at.desc().nullslast(),
            DeviceExamSession.started_at.desc().nullslast(),
            DeviceExamSession.created_at.desc(),
        )
        .all()
    )

    now_utc = datetime.now(timezone.utc)
    items = []
    stale_count = 0
    active_count = 0
    pending_pair_count = 0

    for session, device, patient in rows:
        freshness = _freshness_status(
            last_seen_at=session.last_seen_at,
            stale_after_seconds=stale_after_seconds,
            now_utc=now_utc,
        )
        if freshness == "stale" or session.status == DeviceExamSessionStatus.stale:
            stale_count += 1
        if session.status == DeviceExamSessionStatus.active:
            active_count += 1
        elif session.status == DeviceExamSessionStatus.pending_pair:
            pending_pair_count += 1

        items.append(
            {
                "session_id": session.id,
                "patient_id": session.patient_id,
                "patient_name": _full_patient_name(patient),
                "encounter_id": session.encounter_id,
                "device_id": session.device_id,
                "device_display_name": device.display_name if device else None,
                "measurement_type": session.measurement_type,
                "status": session.status,
                "started_at": session.started_at,
                "last_seen_at": session.last_seen_at,
                "freshness_status": freshness,
                "seconds_since_last_seen": _seconds_since(session.last_seen_at, now_utc=now_utc),
                "pairing_code": session.pairing_code,
            }
        )

    return {
        "items": items,
        "total": len(items),
        "active_count": active_count,
        "pending_pair_count": pending_pair_count,
        "stale_count": stale_count,
        "generated_at": now_utc,
    }


@router.get("/device/v1/device-inventory", response_model=DeviceInventoryResponse)
@limiter.limit("120/minute")
def get_device_inventory(
    request: Request,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
    stale_after_seconds: int = Query(default=DEFAULT_STALE_AFTER_SECONDS, ge=10, le=MAX_STALE_AFTER_SECONDS),
):
    if current_user.role not in (UserRole.admin, UserRole.doctor, UserRole.medical_student):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Required roles: ['admin', 'doctor', 'medical_student']",
        )

    assigned_patient_ids: set[str] | None = None
    if current_user.role in (UserRole.doctor, UserRole.medical_student):
        assigned_patient_ids = {
            str(patient_id)
            for (patient_id,) in db.query(DoctorPatientAssignment.patient_id)
            .filter(DoctorPatientAssignment.doctor_id == current_user.id)
            .all()
        }

    rows = (
        db.query(DeviceRegistration, DeviceExamSession, Patient)
        .outerjoin(
            DeviceExamSession,
            (DeviceExamSession.device_id == DeviceRegistration.device_id)
            & (DeviceExamSession.status.in_([*OPEN_SESSION_STATUSES, DeviceExamSessionStatus.pending_pair])),
        )
        .outerjoin(Patient, Patient.id == DeviceExamSession.patient_id)
        .order_by(
            DeviceRegistration.is_active.desc(),
            DeviceRegistration.display_name.asc(),
            DeviceRegistration.device_id.asc(),
        )
        .all()
    )

    now_utc = datetime.now(timezone.utc)
    items = []
    idle_count = 0
    in_use_count = 0
    busy_count = 0
    inactive_count = 0

    for device, session, patient in rows:
        item = {
            "device_id": device.device_id,
            "device_display_name": device.display_name,
            "default_measurement_type": device.default_measurement_type,
            "is_active": device.is_active,
            "device_last_seen_at": device.last_seen_at,
            "availability_status": "inactive" if not device.is_active else "idle",
            "session_id": None,
            "patient_id": None,
            "patient_name": None,
            "measurement_type": None,
            "session_started_at": None,
            "session_last_seen_at": None,
            "freshness_status": None,
        }

        if not device.is_active:
            inactive_count += 1
        elif session is None:
            idle_count += 1
        else:
            can_view_session = current_user.role == UserRole.admin or (
                assigned_patient_ids is not None and str(session.patient_id) in assigned_patient_ids
            )
            freshness = _freshness_status(
                last_seen_at=session.last_seen_at,
                stale_after_seconds=stale_after_seconds,
                now_utc=now_utc,
            )
            if can_view_session:
                item.update(
                    {
                        "availability_status": "in_use",
                        "session_id": session.id,
                        "patient_id": session.patient_id,
                        "patient_name": _full_patient_name(patient) if patient else str(session.patient_id),
                        "measurement_type": session.measurement_type,
                        "session_started_at": session.started_at,
                        "session_last_seen_at": session.last_seen_at,
                        "freshness_status": freshness,
                    }
                )
                in_use_count += 1
            else:
                item.update(
                    {
                        "availability_status": "busy",
                        "freshness_status": freshness,
                        "session_last_seen_at": session.last_seen_at,
                    }
                )
                busy_count += 1

        items.append(item)

    return {
        "items": items,
        "total": len(items),
        "idle_count": idle_count,
        "in_use_count": in_use_count,
        "busy_count": busy_count,
        "inactive_count": inactive_count,
        "generated_at": now_utc,
    }


@router.get("/device/v1/review/lung-sounds", response_model=LungSoundReviewQueueResponse)
@limiter.limit("120/minute")
def get_lung_sound_review_queue(
    request: Request,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
    limit: int = Query(default=100, ge=1, le=500),
    routing_status: DeviceMeasurementRoutingStatus | None = Query(default=None),
    device_id: str | None = Query(default=None, min_length=1, max_length=128),
):
    if current_user.role not in (UserRole.admin, UserRole.doctor):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Required roles: ['admin', 'doctor']",
        )

    allowed_statuses = [
        DeviceMeasurementRoutingStatus.needs_review,
        DeviceMeasurementRoutingStatus.unmatched,
    ]
    if routing_status is not None and routing_status not in allowed_statuses:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="routing_status filter must be one of: needs_review, unmatched",
        )
    target_statuses = [routing_status] if routing_status is not None else allowed_statuses

    query = (
        db.query(LungSoundRecord, DeviceExamSession, Patient)
        .outerjoin(DeviceExamSession, DeviceExamSession.id == LungSoundRecord.device_exam_session_id)
        .outerjoin(Patient, Patient.id == LungSoundRecord.patient_id)
        .filter(LungSoundRecord.routing_status.in_(target_statuses))
    )

    if device_id:
        query = query.filter(LungSoundRecord.device_id == device_id.strip())

    if current_user.role == UserRole.doctor:
        query = query.join(
            DoctorPatientAssignment,
            DoctorPatientAssignment.patient_id == LungSoundRecord.patient_id,
        ).filter(DoctorPatientAssignment.doctor_id == current_user.id)

    rows = (
        query.order_by(
            LungSoundRecord.server_received_at.desc(),
            LungSoundRecord.created_at.desc(),
        )
        .limit(limit)
        .all()
    )

    needs_review_count_query = db.query(func.count(LungSoundRecord.id)).filter(
        LungSoundRecord.routing_status == DeviceMeasurementRoutingStatus.needs_review
    )
    unmatched_count_query = db.query(func.count(LungSoundRecord.id)).filter(
        LungSoundRecord.routing_status == DeviceMeasurementRoutingStatus.unmatched
    )
    if current_user.role == UserRole.doctor:
        needs_review_count_query = needs_review_count_query.join(
            DoctorPatientAssignment,
            DoctorPatientAssignment.patient_id == LungSoundRecord.patient_id,
        ).filter(DoctorPatientAssignment.doctor_id == current_user.id)
        unmatched_count_query = unmatched_count_query.join(
            DoctorPatientAssignment,
            DoctorPatientAssignment.patient_id == LungSoundRecord.patient_id,
        ).filter(DoctorPatientAssignment.doctor_id == current_user.id)

    needs_review_count = int(needs_review_count_query.scalar() or 0)
    unmatched_count = int(unmatched_count_query.scalar() or 0)

    return {
        "items": [_serialize_lung_sound_review_item(row) for row in rows],
        "total": len(rows),
        "needs_review_count": needs_review_count,
        "unmatched_count": unmatched_count,
        "generated_at": datetime.now(timezone.utc),
    }


@router.post("/device/v1/review/lung-sounds/{record_id}", response_model=LungSoundReviewQueueItem)
@limiter.limit("60/minute")
def resolve_lung_sound_review_item(
    request: Request,
    payload: LungSoundReviewResolveRequest,
    record_id: UUID = Path(...),
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    if current_user.role not in (UserRole.admin, UserRole.doctor):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Required roles: ['admin', 'doctor']",
        )

    row = (
        db.query(LungSoundRecord, DeviceExamSession, Patient)
        .outerjoin(DeviceExamSession, DeviceExamSession.id == LungSoundRecord.device_exam_session_id)
        .outerjoin(Patient, Patient.id == LungSoundRecord.patient_id)
        .filter(LungSoundRecord.id == record_id)
        .first()
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lung sound review record not found",
        )

    record, current_session, _current_patient = row
    if record.routing_status not in (
        DeviceMeasurementRoutingStatus.needs_review,
        DeviceMeasurementRoutingStatus.unmatched,
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Review action is allowed only for needs_review or unmatched records",
        )

    if current_user.role == UserRole.doctor:
        if record.patient_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Doctors cannot resolve unmatched records without patient assignment",
            )
        assignment = db.query(DoctorPatientAssignment).filter(
            DoctorPatientAssignment.doctor_id == current_user.id,
            DoctorPatientAssignment.patient_id == record.patient_id,
        ).first()
        if assignment is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied for this review record",
            )

    previous_routing_status = record.routing_status.value
    previous_session_id = str(record.device_exam_session_id) if record.device_exam_session_id else None
    previous_patient_id = str(record.patient_id) if record.patient_id else None

    target_session: DeviceExamSession | None = None
    if payload.resolution == "verified":
        target_session = db.query(DeviceExamSession).filter(DeviceExamSession.id == payload.target_session_id).first()
        if target_session is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Target device session not found",
            )
        if target_session.device_id != record.device_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Target session does not belong to the same device",
            )
        if target_session.status not in (
            DeviceExamSessionStatus.active,
            DeviceExamSessionStatus.stale,
            DeviceExamSessionStatus.review_needed,
            DeviceExamSessionStatus.completed,
            DeviceExamSessionStatus.cancelled,
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Target session is not eligible for review resolution",
            )
        if current_user.role == UserRole.doctor:
            assignment = db.query(DoctorPatientAssignment).filter(
                DoctorPatientAssignment.doctor_id == current_user.id,
                DoctorPatientAssignment.patient_id == target_session.patient_id,
            ).first()
            if assignment is None:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Doctor cannot route to an unassigned patient session",
                )

        record.routing_status = DeviceMeasurementRoutingStatus.verified
        record.device_exam_session_id = target_session.id
        record.patient_id = target_session.patient_id
    else:
        record.routing_status = DeviceMeasurementRoutingStatus.quarantined
        record.device_exam_session_id = None
        record.patient_id = None

    metadata = dict(record.conflict_metadata or {})
    metadata["manual_review"] = {
        "resolved_at": datetime.now(timezone.utc).isoformat(),
        "resolved_by": str(current_user.id),
        "resolution": payload.resolution,
        "note": payload.note,
        "previous_routing_status": previous_routing_status,
        "previous_session_id": previous_session_id,
        "previous_patient_id": previous_patient_id,
        "target_session_id": str(target_session.id) if target_session else None,
    }
    record.conflict_metadata = metadata

    if current_session and current_session.status == DeviceExamSessionStatus.review_needed and payload.resolution == "verified":
        current_session.status = DeviceExamSessionStatus.completed
        current_session.resolution_reason = DeviceExamSessionResolutionReason.manual_complete
        current_session.ended_by = current_user.id
        current_session.ended_at = current_session.ended_at or datetime.now(timezone.utc)
        current_session.last_seen_at = current_session.last_seen_at or datetime.now(timezone.utc)
        db.add(current_session)

    db.add(record)
    db.commit()
    db.refresh(record)

    refreshed_row = (
        db.query(LungSoundRecord, DeviceExamSession, Patient)
        .outerjoin(DeviceExamSession, DeviceExamSession.id == LungSoundRecord.device_exam_session_id)
        .outerjoin(Patient, Patient.id == LungSoundRecord.patient_id)
        .filter(LungSoundRecord.id == record.id)
        .first()
    )
    assert refreshed_row is not None

    audit_service.log_action(
        db=db,
        user_id=current_user.id,
        action="resolve_lung_sound_review_item",
        resource_type="patient",
        resource_id=record.patient_id,
        details={
            "record_id": str(record.id),
            "device_id": record.device_id,
            "resolution": payload.resolution,
            "previous_routing_status": previous_routing_status,
            "previous_session_id": previous_session_id,
            "target_session_id": str(target_session.id) if target_session else None,
            "note": payload.note,
        },
        ip_address=str(getattr(request.client, "host", "")) if request.client else None,
    )
    return _serialize_lung_sound_review_item(refreshed_row)
