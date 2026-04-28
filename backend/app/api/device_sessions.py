import asyncio
import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.pressure import log_device_error, verify_device_signature
from app.core.limiter import limiter
from app.core.request_utils import get_client_ip
from app.models.enums import DeviceExamSessionStatus, UserRole
from app.models.user import User
from app.schemas.device_exam_session import (
    DeviceExamSessionCreate,
    DeviceExamSessionHeartbeatResponse,
    DeviceExamSessionListResponse,
    DeviceExamSessionOut,
    DeviceExamSessionStatusUpdate,
)
from app.services import audit as audit_service
from app.services.auth import get_current_user, get_db
from app.services.device_exam_session import device_exam_session_service
from app.services.device_session_events import device_session_event_hub

router = APIRouter(prefix="/device-sessions", tags=["device-sessions"])
device_router = APIRouter(tags=["device-sessions"])


def _require_session_operator(current_user: User) -> None:
    if current_user.role not in (UserRole.admin, UserRole.doctor):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")


def _format_sse(event: str, data: dict) -> str:
    payload = json.dumps(data, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n"


async def _device_session_event_stream(
    request: Request,
    *,
    session_id: str | None,
    device_id: str | None,
):
    queue = await device_session_event_hub.subscribe()
    try:
        yield _format_sse("ready", {"status": "ok"})
        while True:
            if await request.is_disconnected():
                break
            try:
                event = await asyncio.wait_for(queue.get(), timeout=15)
            except asyncio.TimeoutError:
                yield _format_sse("heartbeat", {"status": "ok"})
                continue

            if session_id and event.get("session_id") != session_id:
                continue
            if device_id and event.get("device_id") != device_id:
                continue

            yield _format_sse(event.get("type", "message"), event)
    finally:
        await device_session_event_hub.unsubscribe(queue)


@device_router.post(
    "/device/v1/sessions/{session_id}/heartbeat",
    response_model=DeviceExamSessionHeartbeatResponse,
)
@limiter.limit("120/minute")
def heartbeat_device_exam_session_from_device(
    request: Request,
    session_id: UUID,
    db: Session = Depends(get_db),
    _authorized: bool = Depends(verify_device_signature),
):
    device_id = (request.headers.get("x-device-id") or "").strip()
    if not device_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing X-Device-Id header",
        )

    try:
        session = device_exam_session_service.record_device_heartbeat(
            db,
            session_id=session_id,
            device_id=device_id,
        )
        return {
            "status": "ok",
            "session_id": session.id,
            "last_seen_at": session.last_seen_at,
        }
    except HTTPException as exc:
        log_device_error(db, device_id or "unknown", f"HTTP {exc.status_code}", request)
        raise
    except Exception as exc:
        log_device_error(
            db,
            device_id or "unknown",
            f"INTERNAL_ERROR:{exc.__class__.__name__}",
            request,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error",
        )


@router.post("", response_model=DeviceExamSessionOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("60/minute")
def create_device_exam_session(
    request: Request,
    payload: DeviceExamSessionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_session_operator(current_user)
    session = device_exam_session_service.create_session(
        db,
        actor=current_user,
        patient_id=payload.patient_id,
        device_id=payload.device_id,
        measurement_type=payload.measurement_type,
        encounter_id=payload.encounter_id,
        notes=payload.notes,
        activate_now=payload.activate_now,
        ip_address=get_client_ip(request),
    )
    audit_service.log_action(
        db=db,
        user_id=current_user.id,
        action="create_device_exam_session",
        resource_type="patient",
        resource_id=session.patient_id,
        details={
            "device_session_id": str(session.id),
            "device_id": session.device_id,
            "measurement_type": session.measurement_type.value,
            "status": session.status.value,
        },
        ip_address=get_client_ip(request),
    )
    return session


@router.get("", response_model=DeviceExamSessionListResponse)
@limiter.limit("120/minute")
def list_device_exam_sessions(
    request: Request,
    patient_id: UUID | None = Query(default=None),
    device_id: str | None = Query(default=None, min_length=1, max_length=128),
    status_filter: DeviceExamSessionStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_session_operator(current_user)
    items, total = device_exam_session_service.list_sessions(
        db,
        actor=current_user,
        ip_address=get_client_ip(request),
        patient_id=patient_id,
        device_id=device_id.strip() if device_id else None,
        status_filter=status_filter,
        limit=limit,
        offset=offset,
    )
    return {"items": items, "total": total}


@router.get("/events/stream")
async def stream_device_session_events(
    request: Request,
    session_id: UUID | None = Query(default=None),
    device_id: str | None = Query(default=None, min_length=1, max_length=128),
    current_user: User = Depends(get_current_user),
):
    _require_session_operator(current_user)
    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(
        _device_session_event_stream(
            request,
            session_id=str(session_id) if session_id else None,
            device_id=device_id.strip() if device_id else None,
        ),
        headers=headers,
        media_type="text/event-stream",
    )


@router.get("/by-device/{device_id}/active", response_model=DeviceExamSessionOut)
@limiter.limit("120/minute")
def get_active_device_exam_session(
    request: Request,
    device_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_session_operator(current_user)
    return device_exam_session_service.get_active_session_by_device(
        db,
        device_id=device_id.strip(),
        actor=current_user,
        ip_address=get_client_ip(request),
    )


@router.get("/{session_id}", response_model=DeviceExamSessionOut)
@limiter.limit("120/minute")
def get_device_exam_session(
    request: Request,
    session_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_session_operator(current_user)
    return device_exam_session_service.get_session(
        db,
        session_id=session_id,
        actor=current_user,
        ip_address=get_client_ip(request),
    )


@router.post("/{session_id}/activate", response_model=DeviceExamSessionOut)
@limiter.limit("60/minute")
def activate_device_exam_session(
    request: Request,
    session_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_session_operator(current_user)
    session = device_exam_session_service.activate_session(
        db,
        actor=current_user,
        session_id=session_id,
        ip_address=get_client_ip(request),
    )
    audit_service.log_action(
        db=db,
        user_id=current_user.id,
        action="activate_device_exam_session",
        resource_type="patient",
        resource_id=session.patient_id,
        details={
            "device_session_id": str(session.id),
            "device_id": session.device_id,
        },
        ip_address=get_client_ip(request),
    )
    return session


@router.post("/{session_id}/heartbeat", response_model=DeviceExamSessionOut)
@limiter.limit("120/minute")
def heartbeat_device_exam_session(
    request: Request,
    session_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_session_operator(current_user)
    return device_exam_session_service.record_heartbeat(
        db,
        session_id=session_id,
        actor=current_user,
        ip_address=get_client_ip(request),
    )


@router.post("/{session_id}/complete", response_model=DeviceExamSessionOut)
@limiter.limit("60/minute")
def complete_device_exam_session(
    request: Request,
    session_id: UUID,
    payload: DeviceExamSessionStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_session_operator(current_user)
    session = device_exam_session_service.complete_session(
        db,
        actor=current_user,
        session_id=session_id,
        notes=payload.notes,
        ip_address=get_client_ip(request),
    )
    audit_service.log_action(
        db=db,
        user_id=current_user.id,
        action="complete_device_exam_session",
        resource_type="patient",
        resource_id=session.patient_id,
        details={
            "device_session_id": str(session.id),
            "device_id": session.device_id,
        },
        ip_address=get_client_ip(request),
    )
    return session


@router.post("/{session_id}/cancel", response_model=DeviceExamSessionOut)
@limiter.limit("60/minute")
def cancel_device_exam_session(
    request: Request,
    session_id: UUID,
    payload: DeviceExamSessionStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_session_operator(current_user)
    session = device_exam_session_service.cancel_session(
        db,
        actor=current_user,
        session_id=session_id,
        notes=payload.notes,
        ip_address=get_client_ip(request),
    )
    audit_service.log_action(
        db=db,
        user_id=current_user.id,
        action="cancel_device_exam_session",
        resource_type="patient",
        resource_id=session.patient_id,
        details={
            "device_session_id": str(session.id),
            "device_id": session.device_id,
        },
        ip_address=get_client_ip(request),
    )
    return session
