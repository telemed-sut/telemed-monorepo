"""API routes for patient mobile-app authentication.

Endpoints:
  POST /patient-app/register          — Register patient device (phone + code → set PIN)
  POST /patient-app/login             — Login with phone + PIN
  GET  /patient-app/me/meetings       — List my meetings with invite URLs
  POST /patient-app/{patient_id}/code — Staff: generate registration code
"""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.limiter import limiter
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
from app.services import patient_app as patient_app_service
from app.services.auth import get_current_user, get_db, oauth2_scheme

router = APIRouter(prefix="/patient-app", tags=["patient-app"])


# ---------- Staff: generate registration code ----------

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
    """Staff/doctor generates a 6-char registration code for a patient."""
    if current_user.role not in (UserRole.admin, UserRole.doctor):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

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
    )


# ---------- Patient: login ----------

@router.post(
    "/login",
    response_model=PatientAppLoginResponse,
)
@limiter.limit("15/minute")
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
    )


# ---------- Patient: my meetings ----------

@router.get(
    "/me/meetings",
    response_model=PatientMeetingListResponse,
)
@limiter.limit("60/minute")
def get_my_meetings(
    request: Request,
    db: Session = Depends(get_db),
    token: str = Depends(oauth2_scheme),
):
    """Get all meetings for the authenticated patient."""
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    patient = patient_app_service.get_current_patient(token, db)

    return patient_app_service.get_patient_meetings(
        db=db,
        patient_id=str(patient.id),
    )
