"""API routes for patient mobile-app authentication.

Endpoints:
  POST /patient-app/register          — Register patient device (phone + code → set PIN)
  POST /patient-app/login             — Login with phone + PIN
  GET  /patient-app/me/meetings       — List my meetings with current invite snapshot
  POST /patient-app/me/meetings/{id}/invite — Issue/refresh my invite explicitly
  POST /patient-app/{patient_id}/code — Admin/Doctor: generate registration code
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.limiter import get_strict_failed_login_key, limiter
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
from app.schemas.meeting_video import MeetingPatientInviteResponse
from app.services import patient_app as patient_app_service
from app.services import patient as patient_service
from app.services.auth import get_current_user, get_db, oauth2_scheme
from app.core.request_utils import get_client_ip

router = APIRouter(prefix="/patient-app", tags=["patient-app"])


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


# ---------- Patient: register ----------

@router.post(
    "/register",
    response_model=PatientAppRegisterResponse,
)
@limiter.limit("10/minute")
def register_patient(
    request: Request,
    payload: PatientAppRegisterRequest,
    db: Session = Depends(get_db),
):
    """Patient registers with phone + code, sets PIN, gets access token."""
    return patient_app_service.register_patient_app(
        db=db,
        phone=payload.phone,
        code=payload.code,
        pin=payload.pin,
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
    """Patient logs in with phone + PIN."""
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
    token: str = Depends(oauth2_scheme),
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
    token: str = Depends(oauth2_scheme),
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
    token: str = Depends(oauth2_scheme),
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
    token: str = Depends(oauth2_scheme),
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
    token: str = Depends(oauth2_scheme),
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
