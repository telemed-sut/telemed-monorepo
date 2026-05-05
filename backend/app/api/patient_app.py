"""API routes for patient mobile-app authentication.

Endpoints:
  POST /patient-app/register                          — Register patient device (phone + code → set PIN)
  POST /patient-app/login                             — Login with phone + PIN
  POST /patient-app/refresh                           — Refresh access token
  POST /patient-app/logout                            — Revoke current session
  POST /patient-app/logout-all                        — Revoke every session for this patient
  POST /patient-app/me/weight                         — Record my weight
  GET  /patient-app/me/meetings                       — List my meetings with current invite snapshot
  POST /patient-app/me/meetings/{id}/invite           — Issue/refresh my invite explicitly
  GET  /patient-app/me/notifications                  — List my notifications
  POST /patient-app/me/notifications/{id}/read        — Mark one as read
  POST /patient-app/me/notifications/mark-all-read    — Mark all as read
  DELETE /patient-app/me/notifications/{id}           — Delete one notification
  GET  /patient-app/me/stream                         — SSE stream of notifications + heart alerts
  GET  /patient-app/me/heart                          — Heart profile (vitals snapshot, history, meds)
  GET  /patient-app/me/heart/alerts                   — Recent + history of cardiac alerts
  POST /patient-app/{patient_id}/code                 — Admin/Doctor: generate registration code
"""

import asyncio
import json
import logging
from datetime import datetime
from typing import AsyncGenerator
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse

from app.core.limiter import get_strict_failed_login_key, get_strict_client_ip_rate_limit_key, limiter
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.patient_app import (
    PatientAppLoginRequest,
    PatientAppLoginResponse,
    PatientAppRegisterRequest,
    PatientAppRegisterResponse,
    PatientMeetingListResponse,
    PatientRegistrationCodeResponse,
)
from app.schemas.patient_heart import HeartAlertListResponse, HeartProfileOut
from app.schemas.patient_medical_records import (
    HeartSoundListResponse,
    LabListResponse,
    MedicalRecordsBundleOut,
    PatientProfileOut,
    PatientProfileUpdateRequest,
    VisitListResponse,
)
from app.schemas.patient_notification import (
    PatientNotificationCreate,
    PatientNotificationListResponse,
    PatientNotificationOut,
)
from app.schemas.patient_screening import (
    PatientScreeningCreate,
    PatientScreeningListResponse,
    PatientScreeningOut,
    ScreeningTrendsResponse,
)
from app.schemas.weight import WeightRecordCreate, WeightRecordOut
from app.schemas.meeting_video import MeetingPatientInviteResponse
from app.services import patient_app as patient_app_service
from app.services import patient as patient_service
from app.services import patient_heart as patient_heart_service
from app.services import patient_medical_records as patient_medical_records_service
from app.services import patient_notification as patient_notification_service
from app.services import patient_screening as patient_screening_service
from app.services import weight as weight_service
from app.services.auth import get_current_user, get_db
from app.core.request_utils import get_client_ip

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/patient-app", tags=["patient-app"])
patient_app_bearer_scheme = HTTPBearer(
    scheme_name="PatientAppBearer",
    auto_error=False,
    bearerFormat="JWT",
    description="Use the latest access_token returned by /patient-app/register or /patient-app/login.",
)


def get_patient_app_bearer_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(patient_app_bearer_scheme),
) -> str | None:
    return credentials.credentials if credentials else None


def _parse_updated_after(value: str | None) -> datetime | None:
    if value is None:
        return None

    normalized = value.strip()
    if not normalized:
        return None

    # Query strings that inline "+00:00" without URL encoding are decoded as spaces.
    if " " in normalized and ("T" in normalized or normalized.count(":") >= 2):
        normalized = normalized.replace(" ", "+")

    try:
        return datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="updated_after must be a valid ISO-8601 timestamp.",
        ) from exc


# ---------- Admin/Doctor: generate registration code ----------

@router.post(
    "/{patient_id}/code",
    response_model=PatientRegistrationCodeResponse,
)
@limiter.limit("30/minute")
def generate_registration_code(
    request: Request,
    patient_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Admin or assigned doctor generates a 6-char registration code for a patient."""
    if current_user.role not in (UserRole.admin, UserRole.doctor):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    if current_user.role == UserRole.doctor:
        patient = patient_service.get_patient(db, patient_id)
        if not patient:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
        patient_service.verify_doctor_patient_access(
            db,
            current_user=current_user,
            patient_id=patient.id,
            ip_address=get_client_ip(request),
        )

    return patient_app_service.create_registration_code(
        db=db,
        patient_id=patient_id,
        created_by_user_id=str(current_user.id),
    )


@router.post(
    "/{patient_id}/test-notification",
    response_model=PatientNotificationOut,
    status_code=status.HTTP_201_CREATED,
    summary="DEV ONLY — send a real-time test notification by patient ID (no auth)",
)
@limiter.limit("60/minute")
def send_test_notification_to_patient(
    request: Request,
    patient_id: str,
    title: str = Query(default="ทดสอบการแจ้งเตือน"),
    message: str = Query(
        default="นี่คือการทดสอบการแจ้งเตือนแบบเรียลไทม์จากระบบ",
    ),
    category: str = Query(
        default="info",
        pattern="^(critical|warning|info|normal)$",
    ),
    db: Session = Depends(get_db),
):
    """No-auth helper for testing the real-time notification pipeline.

    Just hit:
        POST /patient-app/<patient_id>/test-notification
    with no body and no token — the patient's mobile app should pop a
    SnackBar within a second. Override the message via query params:
        ?title=Hello&message=World&category=warning

    Disabled in production via the APP_ENV env var.
    """
    from app.core.config import get_settings as _get_settings

    if (_get_settings().app_env or "").strip().lower() == "production":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Test notification endpoint is disabled in production.",
        )

    import uuid as _uuid

    try:
        pid = _uuid.UUID(patient_id)
    except (ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid patient ID.",
        ) from exc

    patient = patient_service.get_patient(db, patient_id)
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found."
        )

    logger.warning(
        "Test notification dispatched without auth",
        extra={
            "event": "test_notification_dispatched",
            "patient_id": str(pid),
            "title": title,
            "category": category,
            "ip": get_client_ip(request),
        },
    )

    notification = patient_notification_service.create_for_patient(
        db=db,
        patient_id=pid,
        title=title,
        message=message,
        category=category,
        data={"source": "test_endpoint"},
    )

    return {
        "id": notification.id,
        "user_id": notification.patient_id,
        "title": notification.title,
        "message": notification.message,
        "category": notification.category.value
        if hasattr(notification.category, "value")
        else str(notification.category),
        "data": notification.data,
        "is_read": bool(notification.is_read),
        "created_at": notification.created_at,
    }


@router.post(
    "/{patient_id}/notifications",
    response_model=PatientNotificationOut,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("60/minute")
def push_notification_to_patient(
    request: Request,
    patient_id: str,
    payload: PatientNotificationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Staff sends a real-time notification to a specific patient.

    The patient's mobile app receives it instantly via SSE
    (`/patient-app/me/stream`), and it is also persisted in the
    notifications list. Only admin or assigned doctor can send.
    """
    if current_user.role not in (UserRole.admin, UserRole.doctor):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Access denied"
        )

    import uuid as _uuid

    try:
        pid = _uuid.UUID(patient_id)
    except (ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid patient ID."
        ) from exc

    if current_user.role == UserRole.doctor:
        patient = patient_service.get_patient(db, patient_id)
        if not patient:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found"
            )
        patient_service.verify_doctor_patient_access(
            db,
            current_user=current_user,
            patient_id=patient.id,
            ip_address=get_client_ip(request),
        )

    notification = patient_notification_service.create_for_patient(
        db=db,
        patient_id=pid,
        title=payload.title,
        message=payload.message,
        category=payload.category,
        data=payload.data,
    )
    return {
        "id": notification.id,
        "user_id": notification.patient_id,
        "title": notification.title,
        "message": notification.message,
        "category": notification.category.value
        if hasattr(notification.category, "value")
        else str(notification.category),
        "data": notification.data,
        "is_read": bool(notification.is_read),
        "created_at": notification.created_at,
    }


# ---------- Patient: register ----------

@router.post(
    "/register",
    response_model=PatientAppRegisterResponse,
)
@limiter.limit("10/minute", key_func=get_strict_client_ip_rate_limit_key)
def register_patient(
    request: Request,
    payload: PatientAppRegisterRequest,
    db: Session = Depends(get_db),
):
    """Patient registers with phone + code, sets PIN, gets an access token.

    Use the returned access_token as a Bearer token for /patient-app/me/* requests.
    If the patient logs in again after registration, use the newest token from login.
    """
    return patient_app_service.register_patient_app(
        db=db,
        phone=payload.phone,
        pin=payload.pin,
        code=payload.code,
        user_agent=request.headers.get("user-agent"),
        device_id=patient_app_service.get_patient_device_id_from_headers(request.headers),
    )


# ---------- Patient: login ----------

@router.post(
    "/login",
    response_model=PatientAppLoginResponse,
)
@limiter.limit("15/minute")
@limiter.limit("10/minute", key_func=get_strict_failed_login_key)
def login_patient(
    request: Request,
    payload: PatientAppLoginRequest,
    db: Session = Depends(get_db),
):
    """Patient logs in with phone + PIN and gets the latest access token.

    In Swagger, copy access_token from this response, click Authorize, paste it as
    the Bearer token, then call /patient-app/me/weight.
    """
    return patient_app_service.login_patient_app(
        db=db,
        phone=payload.phone,
        pin=payload.pin,
        user_agent=request.headers.get("user-agent"),
        device_id=patient_app_service.get_patient_device_id_from_headers(request.headers),
    )


@router.post(
    "/refresh",
    response_model=PatientAppLoginResponse,
)
@limiter.limit("30/minute")
def refresh_patient(
    request: Request,
    db: Session = Depends(get_db),
    token: str | None = Depends(get_patient_app_bearer_token),
):
    """Refresh the authenticated patient app token."""
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    return patient_app_service.refresh_patient_app(
        db=db,
        token=token,
        user_agent=request.headers.get("user-agent"),
        device_id=patient_app_service.get_patient_device_id_from_headers(request.headers),
    )


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
)
@limiter.limit("30/minute")
def logout_patient(
    request: Request,
    db: Session = Depends(get_db),
    token: str | None = Depends(get_patient_app_bearer_token),
):
    """Logout the authenticated patient app session."""
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    patient_app_service.logout_patient_app(
        db=db,
        token=token,
        user_agent=request.headers.get("user-agent"),
        device_id=patient_app_service.get_patient_device_id_from_headers(request.headers),
    )


@router.post(
    "/logout-all",
    status_code=status.HTTP_204_NO_CONTENT,
)
@limiter.limit("30/minute")
def logout_all_patient(
    request: Request,
    db: Session = Depends(get_db),
    token: str | None = Depends(get_patient_app_bearer_token),
):
    """Logout every active patient app session for the authenticated patient."""
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    patient_app_service.logout_all_patient_app(
        db=db,
        token=token,
        user_agent=request.headers.get("user-agent"),
        device_id=patient_app_service.get_patient_device_id_from_headers(request.headers),
    )


# ---------- Patient: my vitals ----------

@router.post(
    "/me/weight",
    response_model=WeightRecordOut,
    status_code=status.HTTP_201_CREATED,
    summary="Record my weight",
)
@limiter.limit("30/minute")
def create_my_weight_record(
    request: Request,
    payload: WeightRecordCreate,
    db: Session = Depends(get_db),
    token: str | None = Depends(get_patient_app_bearer_token),
):
    """Record the authenticated patient's weight from the mobile app.

    In Swagger, click Authorize and paste the latest access_token from
    /patient-app/register or /patient-app/login before calling this endpoint.

    The patient identity is resolved from the patient-app token; mobile clients
    must not send a patient_id in the request body.
    """
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    patient = patient_app_service.get_current_patient(
        token,
        db,
        user_agent=request.headers.get("user-agent"),
        device_id=patient_app_service.get_patient_device_id_from_headers(request.headers),
    )
    return weight_service.create_weight_record(
        db=db,
        patient_id=patient.id,
        payload=payload,
        recorded_by=None,
    )


# ---------- Patient: my meetings ----------

@router.get(
    "/me/meetings",
    response_model=PatientMeetingListResponse,
)
@limiter.limit("60/minute")
def get_my_meetings(
    request: Request,
    updated_after: str | None = Query(
        default=None,
        description="Optional ISO-8601 timestamp to return only meetings updated after that point.",
    ),
    db: Session = Depends(get_db),
    token: str | None = Depends(get_patient_app_bearer_token),
):
    """Get all meetings for the authenticated patient."""
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    patient = patient_app_service.get_current_patient(
        token,
        db,
        user_agent=request.headers.get("user-agent"),
        device_id=patient_app_service.get_patient_device_id_from_headers(request.headers),
    )
    updated_after_dt = _parse_updated_after(updated_after)

    return patient_app_service.get_patient_meetings(
        db=db,
        patient_id=str(patient.id),
        updated_after=updated_after_dt,
    )


@router.post(
    "/me/meetings/{meeting_id}/invite",
    response_model=MeetingPatientInviteResponse,
)
@limiter.limit("20/minute")
def issue_my_meeting_invite(
    request: Request,
    meeting_id: str,
    db: Session = Depends(get_db),
    token: str | None = Depends(get_patient_app_bearer_token),
):
    """Issue or refresh an invite for the authenticated patient's meeting."""
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    patient = patient_app_service.get_current_patient(
        token,
        db,
        user_agent=request.headers.get("user-agent"),
        device_id=patient_app_service.get_patient_device_id_from_headers(request.headers),
    )
    return patient_app_service.issue_patient_meeting_invite(
        db=db,
        patient_id=str(patient.id),
        meeting_id=meeting_id,
    )


# ---------- Patient: my notifications ----------


def _resolve_authenticated_patient(
    *,
    request: Request,
    db: Session,
    token: str | None,
):
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    return patient_app_service.get_current_patient(
        token,
        db,
        user_agent=request.headers.get("user-agent"),
        device_id=patient_app_service.get_patient_device_id_from_headers(
            request.headers
        ),
    )


@router.get(
    "/me/notifications",
    response_model=PatientNotificationListResponse,
)
@limiter.limit("60/minute")
def get_my_notifications(
    request: Request,
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    token: str | None = Depends(get_patient_app_bearer_token),
):
    """Get all notifications for the authenticated patient."""
    patient = _resolve_authenticated_patient(request=request, db=db, token=token)
    return patient_notification_service.list_for_patient(
        db=db,
        patient_id=patient.id,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/me/notifications/{notification_id}/read",
    status_code=status.HTTP_204_NO_CONTENT,
)
@limiter.limit("120/minute")
def mark_my_notification_read(
    request: Request,
    notification_id: UUID,
    db: Session = Depends(get_db),
    token: str | None = Depends(get_patient_app_bearer_token),
):
    """Mark a single notification as read."""
    patient = _resolve_authenticated_patient(request=request, db=db, token=token)
    patient_notification_service.mark_read(
        db=db,
        patient_id=patient.id,
        notification_id=notification_id,
    )


@router.post(
    "/me/notifications/mark-all-read",
    status_code=status.HTTP_204_NO_CONTENT,
)
@limiter.limit("30/minute")
def mark_all_my_notifications_read(
    request: Request,
    db: Session = Depends(get_db),
    token: str | None = Depends(get_patient_app_bearer_token),
):
    """Mark every unread notification for this patient as read."""
    patient = _resolve_authenticated_patient(request=request, db=db, token=token)
    patient_notification_service.mark_all_read(db=db, patient_id=patient.id)


@router.delete(
    "/me/notifications/{notification_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
@limiter.limit("60/minute")
def delete_my_notification(
    request: Request,
    notification_id: UUID,
    db: Session = Depends(get_db),
    token: str | None = Depends(get_patient_app_bearer_token),
):
    """Delete a notification owned by this patient."""
    patient = _resolve_authenticated_patient(request=request, db=db, token=token)
    patient_notification_service.delete_for_patient(
        db=db,
        patient_id=patient.id,
        notification_id=notification_id,
    )


# ---------- Patient: real-time SSE stream ----------

_SSE_KEEPALIVE_SECONDS = 20.0
_SSE_DB_POLL_SECONDS = 1.0


@router.get("/me/stream")
async def stream_patient_app_events(
    request: Request,
    db: Session = Depends(get_db),
    token: str | None = Depends(get_patient_app_bearer_token),
):
    """Server-Sent Events stream for the authenticated patient.

    Emits:
      - `event: notification\\ndata: {json}` whenever a new patient notification
        is created for this patient.
      - `event: heart_alert\\ndata: {json}` whenever a heart alert is published.
      - `: keepalive` comments every ~20s so clients/proxies do not idle-close.

    The mobile client (`lib/services/notification_service.dart`) subscribes here
    when the app is foregrounded.
    """
    patient = _resolve_authenticated_patient(request=request, db=db, token=token)

    latest_seen_at = patient_notification_service.latest_created_at(
        db=db,
        patient_id=patient.id,
    )

    async def event_generator() -> AsyncGenerator[dict, None]:
        nonlocal latest_seen_at
        last_keepalive = asyncio.get_event_loop().time()
        try:
            yield {"comment": "patient-app stream connected"}

            while True:
                if await request.is_disconnected():
                    break

                await asyncio.sleep(_SSE_DB_POLL_SECONDS)
                notifications = patient_notification_service.list_created_after(
                    db=db,
                    patient_id=patient.id,
                    created_after=latest_seen_at,
                )
                for notification in notifications:
                    yield {
                        "event": "notification",
                        "data": json.dumps(
                            patient_notification_service.serialize(notification),
                            default=str,
                        ),
                    }
                    latest_seen_at = notification.created_at
                    last_keepalive = asyncio.get_event_loop().time()

                now = asyncio.get_event_loop().time()
                if now - last_keepalive >= _SSE_KEEPALIVE_SECONDS:
                    yield {"comment": "keepalive"}
                    last_keepalive = now
        finally:
            logger.debug("Patient app stream closed", extra={"patient_id": str(patient.id)})

    return EventSourceResponse(event_generator())


# ---------- Patient: heart profile + alerts ----------


@router.get(
    "/me/heart",
    response_model=HeartProfileOut,
)
@limiter.limit("60/minute")
def get_my_heart_profile(
    request: Request,
    history_limit: int = Query(default=30, ge=1, le=200),
    db: Session = Depends(get_db),
    token: str | None = Depends(get_patient_app_bearer_token),
):
    """Aggregated heart/cardiology profile for the authenticated patient."""
    patient = _resolve_authenticated_patient(request=request, db=db, token=token)
    return patient_heart_service.get_profile(
        db=db,
        patient=patient,
        history_limit=history_limit,
    )


@router.get(
    "/me/heart/alerts",
    response_model=HeartAlertListResponse,
)
@limiter.limit("60/minute")
def get_my_heart_alerts(
    request: Request,
    unread_only: bool = Query(default=False),
    db: Session = Depends(get_db),
    token: str | None = Depends(get_patient_app_bearer_token),
):
    """Recent + history of cardiac alerts for the authenticated patient."""
    patient = _resolve_authenticated_patient(request=request, db=db, token=token)
    return patient_heart_service.list_alerts(
        db=db,
        patient_id=patient.id,
        unread_only=unread_only,
    )


# ---------- Patient: medical records (bundle + sub-resources) ----------


@router.get(
    "/me/medical-records",
    response_model=MedicalRecordsBundleOut,
)
@limiter.limit("60/minute")
def get_my_medical_records(
    request: Request,
    weight_history_limit: int = Query(default=30, ge=1, le=200),
    db: Session = Depends(get_db),
    token: str | None = Depends(get_patient_app_bearer_token),
):
    """One-shot bundle for the medical records tab: vitals, weight history,
    conditions, medications, and parsed allergies."""
    patient = _resolve_authenticated_patient(request=request, db=db, token=token)
    return patient_medical_records_service.get_medical_records_bundle(
        db=db,
        patient=patient,
        weight_history_limit=weight_history_limit,
    )


@router.get(
    "/me/medical-records/visits",
    response_model=VisitListResponse,
)
@limiter.limit("60/minute")
def get_my_visits(
    request: Request,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    token: str | None = Depends(get_patient_app_bearer_token),
):
    """Encounters (visits) for the authenticated patient."""
    patient = _resolve_authenticated_patient(request=request, db=db, token=token)
    return patient_medical_records_service.list_visits(
        db=db,
        patient_id=patient.id,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/me/medical-records/labs",
    response_model=LabListResponse,
)
@limiter.limit("60/minute")
def get_my_labs(
    request: Request,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    token: str | None = Depends(get_patient_app_bearer_token),
):
    """Lab orders + results for the authenticated patient."""
    patient = _resolve_authenticated_patient(request=request, db=db, token=token)
    return patient_medical_records_service.list_labs(
        db=db,
        patient_id=patient.id,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/me/heart-sounds",
    response_model=HeartSoundListResponse,
)
@limiter.limit("60/minute")
def get_my_heart_sounds(
    request: Request,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    token: str | None = Depends(get_patient_app_bearer_token),
):
    """Heart sound recordings captured for the authenticated patient."""
    patient = _resolve_authenticated_patient(request=request, db=db, token=token)
    return patient_medical_records_service.list_heart_sounds(
        db=db,
        patient_id=patient.id,
        limit=limit,
        offset=offset,
    )


# ---------- Patient: profile ----------


@router.get(
    "/me/profile",
    response_model=PatientProfileOut,
)
@limiter.limit("60/minute")
def get_my_profile(
    request: Request,
    db: Session = Depends(get_db),
    token: str | None = Depends(get_patient_app_bearer_token),
):
    """Get the authenticated patient's profile."""
    patient = _resolve_authenticated_patient(request=request, db=db, token=token)
    return patient_medical_records_service.serialize_profile(patient)


@router.patch(
    "/me/profile",
    response_model=PatientProfileOut,
)
@limiter.limit("30/minute")
def update_my_profile(
    request: Request,
    payload: PatientProfileUpdateRequest,
    db: Session = Depends(get_db),
    token: str | None = Depends(get_patient_app_bearer_token),
):
    """Update editable profile fields. Phone (login key) and date_of_birth
    (medical record) are not editable from the mobile app."""
    patient = _resolve_authenticated_patient(request=request, db=db, token=token)
    return patient_medical_records_service.update_profile(
        db=db,
        patient=patient,
        first_name=payload.first_name,
        last_name=payload.last_name,
        email=payload.email,
        address=payload.address,
    )


# ---------- Patient: daily heart-failure screening ----------


@router.post(
    "/me/screenings",
    response_model=PatientScreeningOut,
    status_code=status.HTTP_201_CREATED,
    summary="Submit today's screening",
)
@limiter.limit("30/minute")
def submit_my_screening(
    request: Request,
    payload: PatientScreeningCreate,
    db: Session = Depends(get_db),
    token: str | None = Depends(get_patient_app_bearer_token),
):
    """Submit a daily HF-screening entry (symptoms + vitals + warning signs).

    The patient may submit multiple times per day; the latest one is treated
    as canonical for that day. `recorded_at` is server-generated.
    """
    patient = _resolve_authenticated_patient(request=request, db=db, token=token)
    return patient_screening_service.submit(
        db=db,
        patient_id=patient.id,
        payload=payload,
    )


@router.get(
    "/me/screenings",
    response_model=PatientScreeningListResponse,
)
@limiter.limit("60/minute")
def list_my_screenings(
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    token: str | None = Depends(get_patient_app_bearer_token),
):
    """Paginated history of the patient's screening submissions, latest first."""
    patient = _resolve_authenticated_patient(request=request, db=db, token=token)
    return patient_screening_service.list_for_patient(
        db=db,
        patient_id=patient.id,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/me/screenings/today",
    response_model=PatientScreeningOut | None,
)
@limiter.limit("60/minute")
def get_my_today_screening(
    request: Request,
    db: Session = Depends(get_db),
    token: str | None = Depends(get_patient_app_bearer_token),
):
    """Return today's latest screening for the patient, or null if none."""
    patient = _resolve_authenticated_patient(request=request, db=db, token=token)
    return patient_screening_service.get_today(db=db, patient_id=patient.id)


@router.get(
    "/me/screenings/trends",
    response_model=ScreeningTrendsResponse,
)
@limiter.limit("60/minute")
def get_my_screening_trends(
    request: Request,
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    token: str | None = Depends(get_patient_app_bearer_token),
):
    """Vital-sign trend points for the last `days` days (one point per day,
    latest submission wins)."""
    patient = _resolve_authenticated_patient(request=request, db=db, token=token)
    return patient_screening_service.get_trends(
        db=db,
        patient_id=patient.id,
        days=days,
    )
