import base64
import hashlib
import hmac
import json
import re
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.enums import MeetingStatus
from app.models.meeting import Meeting
from app.models.meeting_patient_invite_code import MeetingPatientInviteCode
from app.models.user import User

URL_ROOM_PATTERN = re.compile(r"^https?://", re.IGNORECASE)
ZEGO_IDENTIFIER_SANITIZE_PATTERN = re.compile(r"[^a-zA-Z0-9_]")
ZEGO_DUPLICATE_UNDERSCORE_PATTERN = re.compile(r"_+")
MAX_ROOM_ID_LENGTH = 128
MAX_PARTICIPANT_ID_LENGTH = 64
PATIENT_INVITE_TOKEN_PREFIX = "pjoin"
PATIENT_INVITE_TOKEN_TYPE = "meeting_patient_invite"
PATIENT_SHORT_JOIN_PATH = "/p"
PATIENT_PARTICIPANT_PREFIX = "patient"
STAFF_PARTICIPANT_PREFIX = "user"
PATIENT_INVITE_TOKEN_VERSION = "v3"
PATIENT_INVITE_SHORT_CODE_PATTERN = re.compile(r"^[a-z0-9]{6,24}$")
PATIENT_INVITE_SHORT_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
PATIENT_INVITE_SHORT_CODE_LENGTH = 8
PATIENT_INVITE_SHORT_CODE_MAX_RETRIES = 16


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _normalize_zego_identifier(raw_value: str, *, max_length: int) -> str:
    normalized = ZEGO_IDENTIFIER_SANITIZE_PATTERN.sub("_", raw_value.strip())
    normalized = ZEGO_DUPLICATE_UNDERSCORE_PATTERN.sub("_", normalized).strip("_")
    return normalized[:max_length].strip("_")


def _sanitize_room(raw_room: str | None) -> str | None:
    room = (raw_room or "").strip()
    if not room or URL_ROOM_PATTERN.match(room):
        return None
    normalized = _normalize_zego_identifier(room, max_length=MAX_ROOM_ID_LENGTH)
    if not normalized:
        return None
    return normalized


def _compact_identifier(raw_value: str) -> str:
    compact = re.sub(r"[^a-zA-Z0-9]", "", raw_value.strip())
    return compact.lower()


def _derive_participant_id(*, prefix: str, source_id: str) -> str:
    safe_prefix = _normalize_zego_identifier(prefix, max_length=16) or "user"
    compact_id = _compact_identifier(source_id)
    if not compact_id:
        compact_id = "unknown"

    max_compact_length = MAX_PARTICIPANT_ID_LENGTH - len(safe_prefix) - 1
    if max_compact_length <= 0:
        return safe_prefix[:MAX_PARTICIPANT_ID_LENGTH]

    compact_id = compact_id[:max_compact_length]
    return f"{safe_prefix}_{compact_id}"


def derive_staff_participant_id(user_id: str) -> str:
    return _derive_participant_id(prefix=STAFF_PARTICIPANT_PREFIX, source_id=user_id)


def derive_patient_participant_id(patient_id: str) -> str:
    return _derive_participant_id(prefix=PATIENT_PARTICIPANT_PREFIX, source_id=patient_id)


def derive_room_id(meeting: Meeting) -> str:
    settings = get_settings()
    preset_room = _sanitize_room(meeting.room)
    if preset_room:
        return preset_room

    prefix = _normalize_zego_identifier(
        settings.meeting_video_room_prefix,
        max_length=24,
    ) or "telemed"
    fallback = _normalize_zego_identifier(
        f"{prefix}_{meeting.id.hex}",
        max_length=MAX_ROOM_ID_LENGTH,
    )
    if fallback:
        return fallback
    return f"telemed_{meeting.id.hex}"


def _b64_url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _b64_url_decode(data: str) -> bytes:
    padding = "=" * ((4 - len(data) % 4) % 4)
    return base64.urlsafe_b64decode(data + padding)


def _normalize_uuid_text(value: str) -> str:
    text = (value or "").strip()
    if not text:
        return ""
    try:
        return str(uuid.UUID(text))
    except (ValueError, AttributeError, TypeError):
        compact = re.sub(r"[^a-fA-F0-9]", "", text)
        if len(compact) != 32:
            return text.lower()
        try:
            return str(uuid.UUID(compact))
        except ValueError:
            return text.lower()


def normalize_meeting_id_text(value: str) -> str:
    return _normalize_uuid_text(value)


def _normalize_patient_short_code(value: str) -> str:
    normalized = (value or "").strip().lower()
    if not PATIENT_INVITE_SHORT_CODE_PATTERN.fullmatch(normalized):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid patient short code.",
        )
    return normalized


def _generate_patient_short_code() -> str:
    return "".join(
        secrets.choice(PATIENT_INVITE_SHORT_CODE_ALPHABET)
        for _ in range(PATIENT_INVITE_SHORT_CODE_LENGTH)
    )


def build_patient_short_invite_url(code: str) -> str:
    settings = get_settings()
    base_url = (
        settings.meeting_patient_join_base_url or settings.frontend_base_url
    ).rstrip("/")
    return f"{base_url}{PATIENT_SHORT_JOIN_PATH}/{code}"


def _build_patient_invite_token(
    *,
    meeting_id: str,
    patient_id: str,
    room_id: str,
    expires_at_unix: int,
) -> str:
    nonce = _b64_url(str(time.time_ns()).encode("utf-8"))[:10]
    payload_v3 = (
        f"{PATIENT_INVITE_TOKEN_VERSION}:{meeting_id}:{patient_id}:{room_id}:{expires_at_unix}:{nonce}"
    )
    compact_payload = _b64_url(payload_v3.encode("utf-8"))
    signature = _sign_compact_payload(compact_payload)
    return f"{PATIENT_INVITE_TOKEN_PREFIX}.{compact_payload}.{signature}"


def _sign_compact_payload(compact_payload: str) -> str:
    settings = get_settings()
    signing_secret = (settings.meeting_signing_secret or "").strip()
    if not signing_secret and settings.app_env != "production" and settings.meeting_signing_allow_jwt_secret_fallback:
        signing_secret = settings.jwt_secret

    if not signing_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Meeting signing secret is missing; unable to sign meeting token.",
        )

    signature = hmac.new(
        signing_secret.encode("utf-8"),
        compact_payload.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return _b64_url(signature)


def _generate_mock_token(
    *,
    user_id: str,
    room_id: str,
    meeting_id: str,
    issued_at: datetime,
    expires_at: datetime,
) -> str:
    claims = {
        "iss": "telemed-backend",
        "typ": "meeting_video_mock",
        "sub": user_id,
        "meeting_id": meeting_id,
        "room_id": room_id,
        "iat": int(issued_at.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    payload_json = json.dumps(claims, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload = _b64_url(payload_json)
    signature = _sign_compact_payload(payload)
    return f"mock.{payload}.{signature}"


def _generate_zego_token(
    *,
    user_id: str,
    expires_in_seconds: int,
) -> str:
    settings = get_settings()
    try:
        from app.services.zego_token import ZegoTokenGenerationError, generate_token04  # type: ignore
    except ImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=(
                "ZEGO token generator is not wired yet. Add app.services.zego_token.generate_token04 "
                "or use MEETING_VIDEO_PROVIDER=mock for local integration."
            ),
        ) from exc

    try:
        return generate_token04(
            app_id=settings.zego_app_id,
            user_id=user_id,
            server_secret=settings.zego_server_secret,
            effective_time_in_seconds=expires_in_seconds,
            payload="",
        )
    except HTTPException:
        raise
    except ZegoTokenGenerationError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate ZEGO token.",
        ) from exc


def _ensure_meeting_is_joinable(meeting: Meeting) -> None:
    if meeting.status in (MeetingStatus.cancelled, MeetingStatus.completed):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Meeting is not joinable.",
        )


def _issue_video_token_for_participant(
    *,
    meeting: Meeting,
    participant_id: str,
    expires_in_seconds: int | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    provider = settings.meeting_video_provider
    if provider == "disabled":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Meeting video provider is disabled.",
        )

    _ensure_meeting_is_joinable(meeting)

    ttl = expires_in_seconds or settings.meeting_video_token_ttl_seconds
    issued_at = datetime.now(timezone.utc)
    expires_at = issued_at + timedelta(seconds=ttl)
    room_id = derive_room_id(meeting)

    if provider == "mock":
        token = _generate_mock_token(
            user_id=participant_id,
            room_id=room_id,
            meeting_id=str(meeting.id),
            issued_at=issued_at,
            expires_at=expires_at,
        )
        return {
            "provider": "mock",
            "meeting_id": str(meeting.id),
            "app_id": None,
            "room_id": room_id,
            "user_id": participant_id,
            "token": token,
            "issued_at": issued_at,
            "expires_at": expires_at,
        }

    token = _generate_zego_token(
        user_id=participant_id,
        expires_in_seconds=ttl,
    )
    return {
        "provider": "zego",
        "meeting_id": str(meeting.id),
        "app_id": settings.zego_app_id,
        "room_id": room_id,
        "user_id": participant_id,
        "token": token,
        "issued_at": issued_at,
        "expires_at": expires_at,
    }


def _create_patient_short_code_record(
    *,
    db: Session,
    meeting: Meeting,
    expires_at: datetime,
    created_by_user_id: str | None = None,
) -> MeetingPatientInviteCode:
    creator_uuid: uuid.UUID | None = None
    if created_by_user_id:
        try:
            creator_uuid = uuid.UUID(str(created_by_user_id).strip())
        except (ValueError, TypeError, AttributeError):
            creator_uuid = None

    for _ in range(PATIENT_INVITE_SHORT_CODE_MAX_RETRIES):
        short_code = _generate_patient_short_code()
        short_link = MeetingPatientInviteCode(
            meeting_id=meeting.id,
            code=short_code,
            expires_at=expires_at,
            created_by=creator_uuid,
        )
        db.add(short_link)
        try:
            db.commit()
            db.refresh(short_link)
            return short_link
        except IntegrityError:
            db.rollback()

    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Failed to generate patient short link.",
    )


def get_active_patient_invite_code(
    *,
    db: Session,
    meeting_id: uuid.UUID,
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


def _resolve_patient_short_code_record(
    *,
    db: Session,
    short_code: str,
) -> MeetingPatientInviteCode:
    normalized = _normalize_patient_short_code(short_code)
    short_link = db.scalar(
        select(MeetingPatientInviteCode).where(
            MeetingPatientInviteCode.code == normalized
        )
    )
    if not short_link:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Patient short code is invalid.",
        )

    now = datetime.now(timezone.utc)
    expires_at = short_link.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= now:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Patient short code expired.",
        )
    return short_link


def _resolve_patient_invite_expiry(
    *,
    meeting: Meeting,
    issued_at: datetime,
    expires_in_seconds: int | None = None,
) -> datetime:
    settings = get_settings()
    ttl = expires_in_seconds or settings.meeting_patient_invite_ttl_seconds
    default_expiry = issued_at + timedelta(seconds=ttl)
    if not meeting.date_time:
        return default_expiry

    meeting_time = _as_utc(meeting.date_time)
    scheduled_expiry = meeting_time + timedelta(seconds=ttl)
    if scheduled_expiry > default_expiry:
        return scheduled_expiry
    return default_expiry


def _build_patient_invite_response(
    *,
    meeting: Meeting,
    invite_code: MeetingPatientInviteCode,
    issued_at: datetime,
) -> dict[str, Any]:
    expires_at = _as_utc(invite_code.expires_at)
    if not meeting.user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Meeting has no patient assigned.",
        )
    room_id = derive_room_id(meeting)
    return {
        "meeting_id": str(meeting.id),
        "room_id": room_id,
        "invite_token": _build_patient_invite_token(
            meeting_id=str(meeting.id),
            patient_id=str(meeting.user_id),
            room_id=room_id,
            expires_at_unix=int(expires_at.timestamp()),
        ),
        "short_code": invite_code.code,
        "invite_url": build_patient_short_invite_url(invite_code.code),
        "issued_at": issued_at,
        "expires_at": expires_at,
    }


def deactivate_patient_join_invites(
    *,
    db: Session,
    meeting: Meeting,
    clear_meeting_url: bool = True,
) -> None:
    now = datetime.now(timezone.utc)
    invite_codes = db.scalars(
        select(MeetingPatientInviteCode).where(
            MeetingPatientInviteCode.meeting_id == meeting.id
        )
    ).all()
    for invite_code in invite_codes:
        if _as_utc(invite_code.expires_at) > now:
            invite_code.expires_at = now
            db.add(invite_code)

    if clear_meeting_url:
        meeting.patient_invite_url = None
        db.add(meeting)

    db.commit()


def ensure_patient_join_invite(
    *,
    db: Session,
    meeting: Meeting,
    created_by_user_id: str | None = None,
    expires_in_seconds: int | None = None,
) -> dict[str, Any]:
    return create_patient_join_invite(
        db=db,
        meeting=meeting,
        created_by_user_id=created_by_user_id,
        expires_in_seconds=expires_in_seconds,
    )


def create_patient_join_invite(
    *,
    db: Session,
    meeting: Meeting,
    created_by_user_id: str | None = None,
    expires_in_seconds: int | None = None,
) -> dict[str, Any]:
    if not meeting.user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Meeting has no patient assigned.",
        )

    _ensure_meeting_is_joinable(meeting)

    issued_at = datetime.now(timezone.utc)
    expires_at = _resolve_patient_invite_expiry(
        meeting=meeting,
        issued_at=issued_at,
        expires_in_seconds=expires_in_seconds,
    )
    active_short_link = get_active_patient_invite_code(
        db=db,
        meeting_id=meeting.id,
    )
    if active_short_link:
        if _as_utc(active_short_link.expires_at) < expires_at:
            active_short_link.expires_at = expires_at
            db.add(active_short_link)
        meeting.patient_invite_url = build_patient_short_invite_url(
            active_short_link.code
        )
        db.add(meeting)
        db.commit()
        db.refresh(active_short_link)
        return _build_patient_invite_response(
            meeting=meeting,
            invite_code=active_short_link,
            issued_at=issued_at,
        )

    short_link = _create_patient_short_code_record(
        db=db,
        meeting=meeting,
        expires_at=expires_at,
        created_by_user_id=created_by_user_id,
    )

    # Persist the invite URL on the meeting for the patient app to query
    meeting.patient_invite_url = build_patient_short_invite_url(short_link.code)
    db.add(meeting)
    db.commit()

    return _build_patient_invite_response(
        meeting=meeting,
        invite_code=short_link,
        issued_at=issued_at,
    )


def _decode_patient_invite_token(invite_token: str) -> dict[str, Any]:
    token = (invite_token or "").strip()
    parts = token.split(".", 2)
    if len(parts) != 3 or parts[0] != PATIENT_INVITE_TOKEN_PREFIX:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid patient invite token.",
        )

    compact_payload = parts[1]
    signature = parts[2]
    expected_signature = _sign_compact_payload(compact_payload)
    if not hmac.compare_digest(signature, expected_signature):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid patient invite token signature.",
        )

    try:
        decoded_payload = _b64_url_decode(compact_payload).decode("utf-8")
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid patient invite token payload.",
        ) from exc

    # Backward-compatible parser: support previous JSON payload tokens.
    if decoded_payload.startswith("{"):
        try:
            payload = json.loads(decoded_payload)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid patient invite token payload.",
            ) from exc
        if not isinstance(payload, dict):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid patient invite token payload.",
            )
        return payload

    # Compact payload:
    # v3:<meeting_id>:<patient_id>:<room_id>:<exp>:<nonce>
    # v2:<meeting_id>:<exp>:<nonce> (legacy)
    parts_payload = decoded_payload.split(":")
    if len(parts_payload) not in (4, 6):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid patient invite token payload.",
        )

    version = parts_payload[0]
    if version == "v2" and len(parts_payload) == 4:
        _, meeting_id_raw, exp_raw, _nonce = parts_payload
        meeting_id = _normalize_uuid_text(meeting_id_raw)
        try:
            exp = int(exp_raw)
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid patient invite token expiry.",
            ) from exc
        return {
            "typ": PATIENT_INVITE_TOKEN_TYPE,
            "mid": meeting_id,
            "exp": exp,
        }

    if version != PATIENT_INVITE_TOKEN_VERSION or len(parts_payload) != 6:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid patient invite token payload.",
        )

    _, meeting_id_raw, patient_id_raw, room_id_raw, exp_raw, _nonce = parts_payload
    meeting_id = _normalize_uuid_text(meeting_id_raw)
    patient_id = _normalize_uuid_text(patient_id_raw)
    room_id = (room_id_raw or "").strip()
    try:
        exp = int(exp_raw)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid patient invite token expiry.",
        ) from exc

    return {
        "typ": PATIENT_INVITE_TOKEN_TYPE,
        "mid": meeting_id,
        "pid": patient_id,
        "rid": room_id,
        "exp": exp,
    }


def _validate_patient_invite_claim_shape(claims: dict[str, Any]) -> None:
    token_type = claims.get("typ")
    meeting_id = _normalize_uuid_text(str(claims.get("mid") or ""))
    patient_id = _normalize_uuid_text(str(claims.get("pid") or ""))
    room_id = str(claims.get("rid") or "").strip()

    if token_type != PATIENT_INVITE_TOKEN_TYPE:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid patient invite token type.",
        )

    if not meeting_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid patient invite token payload.",
        )

    if not patient_id or not room_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid patient invite token payload.",
        )


def _validate_patient_invite_expiry(claims: dict[str, Any]) -> None:
    expires_at = claims.get("exp")
    try:
        exp = int(expires_at)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid patient invite token expiry.",
        ) from exc

    if exp <= int(time.time()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Patient invite token expired.",
        )


def _validate_patient_invite_claims(*, meeting: Meeting, claims: dict[str, Any]) -> None:
    expected_meeting_id = _normalize_uuid_text(str(meeting.id))
    expected_patient_id = _normalize_uuid_text(str(meeting.user_id)) if meeting.user_id else ""

    meeting_id = _normalize_uuid_text(str(claims.get("mid") or ""))
    patient_id_raw = str(claims.get("pid") or "")
    patient_id = _normalize_uuid_text(patient_id_raw) if patient_id_raw else ""
    room_id = str(claims.get("rid") or "")
    _validate_patient_invite_claim_shape(claims)

    if meeting_id != expected_meeting_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Patient invite token does not match this meeting.",
        )

    if patient_id and patient_id != expected_patient_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Patient invite token does not match meeting patient.",
        )

    if not expected_patient_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Patient invite token does not match meeting patient.",
        )

    if room_id and room_id != derive_room_id(meeting):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Patient invite token room mismatch.",
        )
    _validate_patient_invite_expiry(claims)


def extract_meeting_id_from_patient_invite_token(invite_token: str) -> str:
    claims = _decode_patient_invite_token(invite_token)
    _validate_patient_invite_claim_shape(claims)
    _validate_patient_invite_expiry(claims)
    meeting_id = _normalize_uuid_text(str(claims.get("mid") or ""))
    return meeting_id


def extract_meeting_id_from_patient_short_code(db: Session, short_code: str) -> str:
    short_link = _resolve_patient_short_code_record(db=db, short_code=short_code)
    return str(short_link.meeting_id)


def issue_patient_meeting_video_token(
    *,
    meeting: Meeting,
    invite_token: str,
    expires_in_seconds: int | None = None,
) -> dict[str, Any]:
    _ensure_meeting_is_joinable(meeting)

    claims = _decode_patient_invite_token(invite_token)
    _validate_patient_invite_claims(meeting=meeting, claims=claims)

    if not meeting.user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Meeting has no patient assigned.",
        )

    participant_id = derive_patient_participant_id(str(meeting.user_id))
    return _issue_video_token_for_participant(
        meeting=meeting,
        participant_id=participant_id,
        expires_in_seconds=expires_in_seconds,
    )


def issue_patient_meeting_video_token_by_short_code(
    *,
    db: Session,
    meeting: Meeting,
    short_code: str,
    expires_in_seconds: int | None = None,
) -> dict[str, Any]:
    _ensure_meeting_is_joinable(meeting)
    short_link = _resolve_patient_short_code_record(db=db, short_code=short_code)
    if short_link.meeting_id != meeting.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Patient short code does not match this meeting.",
        )

    if not meeting.user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Meeting has no patient assigned.",
        )

    participant_id = derive_patient_participant_id(str(meeting.user_id))
    return _issue_video_token_for_participant(
        meeting=meeting,
        participant_id=participant_id,
        expires_in_seconds=expires_in_seconds,
    )


def issue_meeting_video_token(
    *,
    meeting: Meeting,
    current_user: User,
    expires_in_seconds: int | None = None,
) -> dict[str, Any]:
    participant_id = derive_staff_participant_id(str(current_user.id))
    return _issue_video_token_for_participant(
        meeting=meeting,
        participant_id=participant_id,
        expires_in_seconds=expires_in_seconds,
    )
