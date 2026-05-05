"""Service layer for patient mobile-app authentication and registration."""

import hashlib
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.config import get_settings
from app.core.security import create_access_token, get_pin_hash, hash_security_token, verify_pin
from app.models.meeting import Meeting
from app.models.patient import Patient
from app.models.patient_app_registration import PatientAppRegistration
from app.services import meeting_presence as meeting_presence_service
from app.services import meeting_video as meeting_video_service
from app.services import patient_app_sessions as patient_app_session_service
from app.services.redis_runtime import (
    decode_cached_value,
    get_redis_client_or_log,
    log_redis_operation_failure,
    parse_cached_datetime,
)

logger = logging.getLogger(__name__)

_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_CODE_LENGTH = 6
_CODE_MAX_RETRIES = 16
_REGISTRATION_CODE_TTL_HOURS = 72
_PATIENT_DEVICE_HEADER_NAMES = ("x-patient-device-id", "x-device-id")
_PATIENT_REGISTRATION_REDIS_PREFIX = "patient_app_registration:v1:"
settings = get_settings()


def _generate_code() -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_LENGTH))


def _normalize_phone(phone: str) -> str:
    return re.sub(r"[\s\-().]", "", phone.strip())


def _phone_digits(phone: str) -> str:
    return re.sub(r"\D", "", phone or "")


def _phone_variants(phone: str) -> set[str]:
    normalized = _normalize_phone(phone)
    digits = _phone_digits(phone)
    variants = {normalized, digits}

    if digits.startswith("66") and len(digits) > 2:
        local_variant = f"0{digits[2:]}"
        variants.add(local_variant)
        variants.add(f"+{digits}")

    if digits.startswith("0") and len(digits) > 1:
        intl_variant = f"66{digits[1:]}"
        variants.add(intl_variant)
        variants.add(f"+{intl_variant}")

    return {variant for variant in variants if variant}


def _phones_match(candidate_phone: str, stored_phone: str) -> bool:
    return bool(_phone_variants(candidate_phone) & _phone_variants(stored_phone))


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _generate_patient_session_id() -> str:
    return secrets.token_urlsafe(32)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _registration_cache_key(code: str) -> str:
    normalized = (code or "").strip().upper()
    hashed = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return f"{_PATIENT_REGISTRATION_REDIS_PREFIX}{hashed}"


def _get_patient_registration_redis_client():
    return get_redis_client_or_log(
        logger,
        scope="patient_registration_cache",
        fallback_label="database",
    )


def _cache_registration_code(registration: PatientAppRegistration) -> None:
    redis_client = _get_patient_registration_redis_client()
    if redis_client is None:
        return

    expires_at = _as_utc(registration.expires_at)
    ttl_seconds = int((expires_at - _now_utc()).total_seconds())
    cache_key = _registration_cache_key(registration.code)
    if ttl_seconds <= 0 or registration.is_used:
        try:
            redis_client.delete(cache_key)
        except Exception:
            log_redis_operation_failure(
                logger,
                scope="patient_registration_cache",
                operation="delete_expired_entry",
                fallback_label="database",
            )
        return

    payload = {
        "registration_id": str(registration.id),
        "patient_id": str(registration.patient_id),
        "code": registration.code,
        "expires_at": expires_at.isoformat(),
    }
    try:
        redis_client.hset(cache_key, mapping=payload)
        redis_client.expire(cache_key, ttl_seconds)
    except Exception:
        log_redis_operation_failure(
            logger,
            scope="patient_registration_cache",
            operation="write",
            fallback_label="database",
        )


def _clear_registration_code_cache(code: str | None) -> None:
    if not code:
        return
    redis_client = _get_patient_registration_redis_client()
    if redis_client is None:
        return
    try:
        redis_client.delete(_registration_cache_key(code))
    except Exception:
        log_redis_operation_failure(
            logger,
            scope="patient_registration_cache",
            operation="delete",
            fallback_label="database",
        )


def _resolve_active_registration(
    *,
    db: Session,
    normalized_code: str,
) -> PatientAppRegistration | None:
    redis_client = _get_patient_registration_redis_client()
    if redis_client is not None:
        try:
            payload = redis_client.hgetall(_registration_cache_key(normalized_code))
        except Exception:
            log_redis_operation_failure(
                logger,
                scope="patient_registration_cache",
                operation="read",
                fallback_label="database",
            )
            payload = {}
        if payload:
            registration_id = decode_cached_value(payload.get("registration_id"))
            expires_at = parse_cached_datetime(payload.get("expires_at"))
            if registration_id and expires_at and expires_at > _now_utc():
                try:
                    reg = db.get(PatientAppRegistration, UUID(registration_id))
                except (ValueError, TypeError):
                    reg = None
                if reg is not None and not reg.is_used:
                    return reg
            _clear_registration_code_cache(normalized_code)

    reg = db.scalar(
        select(PatientAppRegistration).where(
            and_(
                PatientAppRegistration.code == normalized_code,
                PatientAppRegistration.is_used.is_(False),
            )
        )
    )
    if reg is not None:
        _cache_registration_code(reg)
    return reg


def _normalize_device_context_value(value: str | None, *, max_length: int = 512) -> str:
    return (value or "").strip()[:max_length]


def get_patient_device_id_from_headers(headers) -> str | None:
    for header_name in _PATIENT_DEVICE_HEADER_NAMES:
        value = _normalize_device_context_value(headers.get(header_name))
        if value:
            return value
    return None


def build_patient_device_context(*, user_agent: str | None, device_id: str | None) -> str | None:
    normalized_user_agent = _normalize_device_context_value(user_agent)
    normalized_device_id = _normalize_device_context_value(device_id)
    return hash_security_token(
        f"patient-app:{normalized_device_id or 'no-device'}:{normalized_user_agent or 'no-user-agent'}"
    )


def _get_patient_token_ttl_seconds() -> int:
    return max(int(settings.patient_app_token_ttl_seconds), 300)


def _check_patient_account_locked(patient: Patient | None) -> datetime | None:
    if not patient or not patient.app_account_locked_until:
        return None

    locked_until = _as_utc(patient.app_account_locked_until)
    if locked_until <= _now_utc():
        return None

    return locked_until


def _patient_lock_detail(locked_until: datetime) -> str:
    return (
        "Patient account temporarily locked due to repeated failed PIN attempts. "
        f"Try again after {locked_until.astimezone(timezone.utc).isoformat()}."
    )


def _record_failed_patient_login(db: Session, patient: Patient) -> datetime | None:
    now = _now_utc()
    patient.failed_app_login_attempts = (patient.failed_app_login_attempts or 0) + 1
    patient.last_app_failed_login_at = now

    if patient.failed_app_login_attempts >= settings.patient_pin_max_login_attempts:
        patient.app_account_locked_until = now + timedelta(minutes=settings.patient_pin_lockout_minutes)

    db.add(patient)
    db.flush()
    return _check_patient_account_locked(patient)


def _reset_patient_login_failures(db: Session, patient: Patient) -> None:
    if (
        (patient.failed_app_login_attempts or 0) > 0
        or patient.app_account_locked_until is not None
        or patient.last_app_failed_login_at is not None
    ):
        patient.failed_app_login_attempts = 0
        patient.app_account_locked_until = None
        patient.last_app_failed_login_at = None
        db.add(patient)
        db.flush()


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
        _clear_registration_code_cache(reg.code)

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
            _cache_registration_code(reg)
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
    pin: str,
    code: str | None = None,
    user_agent: str | None = None,
    device_id: str | None = None,
) -> dict:
    """Bind a PIN to the patient with this phone number, return access token.

    Simplified flow (registration code no longer required): the patient must
    already exist in the patients table with a matching phone number (the
    hospital creates them via the admin web app). Calling /register sets or
    overwrites their PIN and returns a session token.

    The optional `code` parameter is accepted for backward compatibility with
    older mobile builds and is silently ignored.
    """
    del code  # Ignored — kept in signature for backward compatibility.

    normalized_phone = _normalize_phone(phone)
    phone_candidates = sorted(_phone_variants(normalized_phone))

    patient = db.scalar(
        select(Patient)
        .where(
            and_(
                Patient.phone.in_(phone_candidates),
                Patient.deleted_at.is_(None),
                Patient.is_active.is_(True),
            )
        )
        .order_by(Patient.created_at.desc())
    )
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Phone number not found. Please contact your hospital to register first.",
        )

    now = datetime.now(timezone.utc)
    patient.pin_hash = get_pin_hash(pin)
    patient.app_registered_at = patient.app_registered_at or now
    _reset_patient_login_failures(db, patient)

    response = create_patient_login_response(
        db=db,
        patient=patient,
        user_agent=user_agent,
        device_id=device_id,
    )
    db.commit()
    db.refresh(patient)
    return response


# ---------- Patient: login with PIN ----------

def login_patient_app(
    *,
    db: Session,
    phone: str,
    pin: str,
    user_agent: str | None = None,
    device_id: str | None = None,
) -> dict:
    """Authenticate patient by phone + PIN."""
    normalized_phone = _normalize_phone(phone)

    # Query by canonical local/international variants so 081... and +6681...
    # both work without weakening verification to a suffix match.
    phone_candidates = sorted(_phone_variants(normalized_phone))

    matched_patient = db.scalar(
        select(Patient).where(
            and_(
                Patient.phone.in_(phone_candidates),
                Patient.deleted_at.is_(None),
                Patient.is_active.is_(True),
                Patient.pin_hash.isnot(None),
            )
        ).order_by(Patient.created_at.desc())
    )

    if matched_patient:
        locked_until = _check_patient_account_locked(matched_patient)
        if locked_until is not None:
            raise HTTPException(
                status_code=status.HTTP_423_LOCKED,
                detail=_patient_lock_detail(locked_until),
            )

        if not verify_pin(pin, matched_patient.pin_hash):
            locked_until = _record_failed_patient_login(db, matched_patient)
            db.commit()
            if locked_until is not None:
                raise HTTPException(
                    status_code=status.HTTP_423_LOCKED,
                    detail=_patient_lock_detail(locked_until),
                )
            matched_patient = None

    if not matched_patient:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid phone number or PIN.",
        )

    _reset_patient_login_failures(db, matched_patient)
    response = create_patient_login_response(
        db=db,
        patient=matched_patient,
        user_agent=user_agent,
        device_id=device_id,
    )
    db.commit()
    return response


# ---------- Patient: get my meetings ----------

def get_patient_meetings(
    *,
    db: Session,
    patient_id: str,
    updated_after: datetime | None = None,
) -> dict:
    """Return all meetings for this patient without mutating invite state."""
    import uuid as _uuid

    try:
        pid = _uuid.UUID(patient_id)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid patient ID.") from exc

    stmt = (
        select(Meeting)
        .options(
            joinedload(Meeting.doctor),
            joinedload(Meeting.room_presence),
        )
        .where(Meeting.user_id == pid)
        .order_by(Meeting.date_time.desc().nullslast())
    )
    if updated_after is not None:
        stmt = stmt.where(Meeting.updated_at > _as_utc(updated_after))

    meetings = db.scalars(stmt).all()

    items = []
    for m in meetings:
        if m.room_presence:
            meeting_presence_service.apply_runtime_presence_overlay(m.room_presence)
        invite_url = None
        invite_expires_at = None
        invite_code = meeting_video_service.get_active_patient_invite_code(
            db=db,
            meeting_id=m.id,
        )
        if invite_code:
            invite_url = meeting_video_service.build_patient_short_invite_url(
                invite_code.code
            )
            invite_expires_at = invite_code.expires_at

        items.append({
            "id": str(m.id),
            "date_time": m.date_time,
            "description": m.description,
            "status": m.status.value if hasattr(m.status, "value") else str(m.status),
            "note": m.note,
            "patient_invite_url": invite_url,
            "patient_invite_expires_at": invite_expires_at,
            "doctor": m.doctor,
            "room_presence": m.room_presence,
            "created_at": m.created_at,
            "updated_at": m.updated_at,
        })

    return {
        "items": items,
        "total": len(items),
    }


def issue_patient_meeting_invite(
    *,
    db: Session,
    patient_id: str,
    meeting_id: str,
) -> dict:
    """Issue or refresh a patient invite explicitly for a joinable owned meeting."""
    import uuid as _uuid

    try:
        pid = _uuid.UUID(patient_id)
    except (ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid patient ID.",
        ) from exc

    try:
        mid = _uuid.UUID(meeting_id)
    except (ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid meeting ID.",
        ) from exc

    meeting = db.scalar(
        select(Meeting).where(
            and_(
                Meeting.id == mid,
                Meeting.user_id == pid,
            )
        )
    )
    if not meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Meeting not found.",
        )

    active_invite_code = meeting_video_service.get_active_patient_invite_code(
        db=db,
        meeting_id=meeting.id,
    )
    if active_invite_code:
        issued_at = active_invite_code.created_at
        expires_at = active_invite_code.expires_at
        room_id = meeting_video_service.derive_room_id(meeting)
        return {
            "meeting_id": str(meeting.id),
            "room_id": room_id,
            "invite_token": meeting_video_service._build_patient_invite_token(
                meeting_id=str(meeting.id),
                patient_id=str(meeting.user_id),
                room_id=room_id,
                expires_at_unix=int(_as_utc(expires_at).timestamp()),
            ),
            "short_code": active_invite_code.code,
            "invite_url": meeting_video_service.build_patient_short_invite_url(
                active_invite_code.code
            ),
            "issued_at": issued_at,
            "expires_at": expires_at,
        }

    return meeting_video_service.create_patient_join_invite(
        db=db,
        meeting=meeting,
    )


# ---------- Helpers ----------

def _create_patient_token(patient: Patient, *, session_id: str, device_context: str | None) -> str:
    return create_access_token(
        {
            "sub": str(patient.id),
            "type": "patient",
            "role": "patient",
            "session_id": session_id,
            "device_ctx": device_context,
        },
        expires_in=_get_patient_token_ttl_seconds(),
    )


def create_patient_login_response(
    *,
    db: Session,
    patient: Patient,
    user_agent: str | None = None,
    device_id: str | None = None,
) -> dict:
    patient_app_session_service.revoke_patient_sessions(
        db,
        patient_id=UUID(str(patient.id)),
    )
    session_id = _generate_patient_session_id()
    token_ttl_seconds = _get_patient_token_ttl_seconds()
    patient_app_session_service.register_patient_session(
        db,
        patient_id=UUID(str(patient.id)),
        session_id=session_id,
        expires_in_seconds=token_ttl_seconds,
    )
    token = _create_patient_token(
        patient,
        session_id=session_id,
        device_context=build_patient_device_context(user_agent=user_agent, device_id=device_id),
    )
    return {
        "patient_id": str(patient.id),
        "access_token": token,
        "token_type": "bearer",
        "expires_in": token_ttl_seconds,
        "patient_name": patient.name or f"{patient.first_name} {patient.last_name}",
    }


def get_current_patient(
    token: str,
    db: Session,
    *,
    user_agent: str | None = None,
    device_id: str | None = None,
) -> Patient:
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

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token.",
    )
    patient_app_session_service.require_active_patient_session(
        db,
        patient_id=pid,
        session_id=payload.get("session_id"),
        credentials_exception=credentials_exception,
    )

    expected_device_context = payload.get("device_ctx")
    if not expected_device_context:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session must be re-authenticated to continue.",
        )

    current_device_context = build_patient_device_context(
        user_agent=user_agent,
        device_id=device_id,
    )
    if current_device_context != expected_device_context:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session must be used from the original device context.",
        )

    patient = db.get(Patient, pid)
    if not patient or patient.deleted_at is not None or not patient.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Patient account not found or inactive.",
        )

    return patient


def refresh_patient_app(
    *,
    db: Session,
    token: str,
    user_agent: str | None = None,
    device_id: str | None = None,
) -> dict:
    patient = get_current_patient(
        token,
        db,
        user_agent=user_agent,
        device_id=device_id,
    )
    response = create_patient_login_response(
        db=db,
        patient=patient,
        user_agent=user_agent,
        device_id=device_id,
    )
    db.commit()
    return response


def logout_patient_app(
    *,
    db: Session,
    token: str,
    user_agent: str | None = None,
    device_id: str | None = None,
) -> None:
    from app.core.security import decode_token as _decode

    get_current_patient(
        token,
        db,
        user_agent=user_agent,
        device_id=device_id,
    )

    try:
        payload = _decode(token)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
        ) from exc

    if payload.get("type") != "patient":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token is not a patient token.",
        )

    patient_app_session_service.revoke_patient_session(
        db,
        session_id=payload.get("session_id"),
    )
    db.commit()


def logout_all_patient_app(
    *,
    db: Session,
    token: str,
    user_agent: str | None = None,
    device_id: str | None = None,
) -> None:
    patient = get_current_patient(
        token,
        db,
        user_agent=user_agent,
        device_id=device_id,
    )
    patient_app_session_service.revoke_patient_sessions(
        db,
        patient_id=UUID(str(patient.id)),
    )
    db.commit()
