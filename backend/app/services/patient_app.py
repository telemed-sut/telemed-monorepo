"""Service layer for patient mobile-app authentication and registration."""

import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import and_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.config import get_settings
from app.core.security import create_access_token, get_password_hash, verify_password
from app.models.enums import MeetingStatus
from app.models.meeting import Meeting
from app.models.meeting_patient_invite_code import MeetingPatientInviteCode
from app.models.patient import Patient
from app.models.patient_app_registration import PatientAppRegistration
from app.services import meeting_video as meeting_video_service

_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_CODE_LENGTH = 6
_CODE_MAX_RETRIES = 16
_REGISTRATION_CODE_TTL_HOURS = 72
_PATIENT_TOKEN_TTL_SECONDS = 86_400 * 30  # 30 days


def _generate_code() -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_LENGTH))


def _normalize_phone(phone: str) -> str:
    return re.sub(r"[\s\-().]", "", phone.strip())


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _build_patient_short_invite_url(code: str) -> str:
    settings = get_settings()
    base_url = (
        settings.meeting_patient_join_base_url or settings.frontend_base_url
    ).rstrip("/")
    return f"{base_url}/p/{code}"


def _get_active_patient_invite_code(
    *,
    db: Session,
    meeting_id,
) -> MeetingPatientInviteCode | None:
    now = datetime.now(timezone.utc)
    invite_codes = db.scalars(
        select(MeetingPatientInviteCode)
        .where(MeetingPatientInviteCode.meeting_id == meeting_id)
        .order_by(
            MeetingPatientInviteCode.expires_at.desc(),
            MeetingPatientInviteCode.created_at.desc(),
        )
    ).all()

    for invite_code in invite_codes:
        if _as_utc(invite_code.expires_at) > now:
            return invite_code
    return None


# ---------- Staff: generate registration code ----------

def create_registration_code(
    *,
    db: Session,
    patient_id: str,
    created_by_user_id: str | None = None,
) -> dict:
    """Generate a 6-char registration code for a patient."""
    import uuid as _uuid

    try:
        pid = _uuid.UUID(patient_id)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid patient ID.") from exc

    patient = db.get(Patient, pid)
    if not patient or patient.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found.")

    if not patient.phone:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Patient has no phone number. Please add a phone number first.",
        )

    # Invalidate any existing unused codes for this patient.
    existing = db.scalars(
        select(PatientAppRegistration).where(
            and_(
                PatientAppRegistration.patient_id == pid,
                PatientAppRegistration.is_used.is_(False),
            )
        )
    ).all()
    for reg in existing:
        reg.is_used = True
        reg.used_at = datetime.now(timezone.utc)

    creator_uuid = None
    if created_by_user_id:
        try:
            creator_uuid = _uuid.UUID(str(created_by_user_id).strip())
        except (ValueError, TypeError, AttributeError):
            creator_uuid = None

    expires_at = datetime.now(timezone.utc) + timedelta(hours=_REGISTRATION_CODE_TTL_HOURS)

    for _ in range(_CODE_MAX_RETRIES):
        code = _generate_code()
        reg = PatientAppRegistration(
            patient_id=pid,
            code=code,
            expires_at=expires_at,
            created_by=creator_uuid,
        )
        db.add(reg)
        try:
            db.commit()
            db.refresh(reg)
            return {
                "patient_id": str(pid),
                "code": code,
                "expires_at": expires_at,
            }
        except IntegrityError:
            db.rollback()

    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Failed to generate registration code.",
    )


# ---------- Patient: register in app ----------

def register_patient_app(
    *,
    db: Session,
    phone: str,
    code: str,
    pin: str,
) -> dict:
    """Verify phone + code, set PIN, return access token."""
    normalized_phone = _normalize_phone(phone)
    normalized_code = code.strip().upper()

    # Find registration code.
    reg = db.scalar(
        select(PatientAppRegistration).where(
            and_(
                PatientAppRegistration.code == normalized_code,
                PatientAppRegistration.is_used.is_(False),
            )
        )
    )
    if not reg:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired registration code.",
        )

    now = datetime.now(timezone.utc)
    expires_at = reg.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= now:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Registration code has expired. Please ask staff for a new one.",
        )

    # Find patient and verify phone.
    patient = db.get(Patient, reg.patient_id)
    if not patient or patient.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient record not found.",
        )

    patient_phone = _normalize_phone(patient.phone or "")
    if not patient_phone or not normalized_phone.endswith(patient_phone[-4:]):
        # Match on last 4 digits to tolerate country code differences.
        if patient_phone != normalized_phone:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Phone number does not match our records.",
            )

    # Set PIN.
    patient.pin_hash = get_password_hash(pin)
    patient.app_registered_at = now

    # Mark code as used.
    reg.is_used = True
    reg.used_at = now

    db.commit()
    db.refresh(patient)

    token = _create_patient_token(patient)
    settings = get_settings()

    return {
        "patient_id": str(patient.id),
        "access_token": token,
        "token_type": "bearer",
        "expires_in": _PATIENT_TOKEN_TTL_SECONDS,
        "patient_name": patient.name or f"{patient.first_name} {patient.last_name}",
    }


# ---------- Patient: login with PIN ----------

def login_patient_app(
    *,
    db: Session,
    phone: str,
    pin: str,
) -> dict:
    """Authenticate patient by phone + PIN."""
    normalized_phone = _normalize_phone(phone)

    # Find patient by phone.
    patient = db.scalar(
        select(Patient).where(
            and_(
                Patient.phone.isnot(None),
                Patient.deleted_at.is_(None),
                Patient.is_active.is_(True),
                Patient.pin_hash.isnot(None),
            )
        ).order_by(Patient.created_at.desc())
    )

    # We need to check all patients with this phone since query above doesn't filter by phone.
    patients = db.scalars(
        select(Patient).where(
            and_(
                Patient.deleted_at.is_(None),
                Patient.is_active.is_(True),
                Patient.pin_hash.isnot(None),
            )
        )
    ).all()

    matched_patient = None
    for p in patients:
        p_phone = _normalize_phone(p.phone or "")
        if p_phone == normalized_phone or (
            p_phone and normalized_phone and normalized_phone.endswith(p_phone[-4:]) and p_phone.endswith(normalized_phone[-4:])
        ):
            if verify_password(pin, p.pin_hash):
                matched_patient = p
                break

    if not matched_patient:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid phone number or PIN.",
        )

    token = _create_patient_token(matched_patient)

    return {
        "patient_id": str(matched_patient.id),
        "access_token": token,
        "token_type": "bearer",
        "expires_in": _PATIENT_TOKEN_TTL_SECONDS,
        "patient_name": matched_patient.name or f"{matched_patient.first_name} {matched_patient.last_name}",
    }


# ---------- Patient: get my meetings ----------

def get_patient_meetings(
    *,
    db: Session,
    patient_id: str,
) -> dict:
    """Return all meetings for this patient with invite URLs."""
    import uuid as _uuid

    try:
        pid = _uuid.UUID(patient_id)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid patient ID.") from exc

    meetings = db.scalars(
        select(Meeting)
        .options(
            joinedload(Meeting.doctor),
            joinedload(Meeting.room_presence),
        )
        .where(Meeting.user_id == pid)
        .order_by(Meeting.date_time.desc().nullslast())
    ).all()

    items = []
    for m in meetings:
        # Return an active invite URL whenever meeting is joinable.
        invite_url = None
        invite_code = _get_active_patient_invite_code(db=db, meeting_id=m.id)
        if invite_code:
            invite_url = _build_patient_short_invite_url(invite_code.code)

        if not invite_url and m.status not in (MeetingStatus.cancelled, MeetingStatus.completed):
            try:
                invite_payload = meeting_video_service.create_patient_join_invite(
                    db=db,
                    meeting=m,
                )
                invite_url = invite_payload.get("invite_url")
            except HTTPException:
                invite_url = None

        if not invite_url:
            invite_url = m.patient_invite_url

        items.append({
            "id": str(m.id),
            "date_time": m.date_time,
            "description": m.description,
            "status": m.status.value if hasattr(m.status, "value") else str(m.status),
            "note": m.note,
            "patient_invite_url": invite_url,
            "doctor": m.doctor,
            "room_presence": m.room_presence,
            "created_at": m.created_at,
        })

    return {
        "items": items,
        "total": len(items),
    }


# ---------- Helpers ----------

def _create_patient_token(patient: Patient) -> str:
    return create_access_token(
        {
            "sub": str(patient.id),
            "type": "patient",
            "role": "patient",
        },
        expires_in=_PATIENT_TOKEN_TTL_SECONDS,
    )


def get_current_patient(token: str, db: Session) -> Patient:
    """Decode a patient JWT and return the Patient row."""
    from app.core.security import decode_token as _decode

    try:
        payload = _decode(token)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
        ) from exc

    token_type = payload.get("type")
    if token_type != "patient":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token is not a patient token.",
        )

    patient_id = payload.get("sub")
    if not patient_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload.",
        )

    import uuid as _uuid

    try:
        pid = _uuid.UUID(patient_id)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.") from exc

    patient = db.get(Patient, pid)
    if not patient or patient.deleted_at is not None or not patient.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Patient account not found or inactive.",
        )

    return patient
