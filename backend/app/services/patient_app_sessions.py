"""Server-side session registry helpers for patient mobile-app tokens."""

import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.patient_app_session import PatientAppSession
from app.services.redis_runtime import (
    decode_cached_value,
    get_redis_client_or_log,
    parse_cached_datetime,
)
from app.services.session_registry_common import (
    build_session_cache_key,
    cache_session_hash,
    cleanup_stale_sessions,
    clear_cached_session_hash,
    load_cached_session_hash,
    now_utc,
    normalize_dt,
    revoke_owner_sessions,
)

logger = logging.getLogger(__name__)

_PATIENT_SESSION_REDIS_PREFIX = "patient_app_session:v1:"
_PATIENT_SESSION_DB_FLUSH_INTERVAL_SECONDS = 30


def _now_utc() -> datetime:
    return now_utc()


def _normalize_dt(dt: datetime) -> datetime:
    return normalize_dt(dt)


def _session_cache_key(session_id: str) -> str:
    return build_session_cache_key(_PATIENT_SESSION_REDIS_PREFIX, session_id)


def _get_patient_session_redis_client():
    return get_redis_client_or_log(
        logger,
        scope="patient_app_session_cache",
        fallback_label="database",
    )


def _cache_patient_session_state(session: PatientAppSession) -> None:
    expires_at = _normalize_dt(session.expires_at)
    cache_key = _session_cache_key(session.session_id)

    payload = {
        "patient_id": str(session.patient_id),
        "session_id": session.session_id,
        "last_seen_at": _normalize_dt(session.last_seen_at).isoformat(),
        "expires_at": expires_at.isoformat(),
    }
    if session.revoked_at is not None:
        payload["revoked_at"] = _normalize_dt(session.revoked_at).isoformat()

    cache_session_hash(
        redis_client_getter=_get_patient_session_redis_client,
        logger=logger,
        scope="patient_app_session_cache",
        cache_key=cache_key,
        expires_at=expires_at,
        payload=payload,
    )


def _clear_patient_session_cache(session_id: str | None) -> None:
    clear_cached_session_hash(
        redis_client_getter=_get_patient_session_redis_client,
        logger=logger,
        scope="patient_app_session_cache",
        cache_key=_session_cache_key(session_id) if session_id else None,
    )


def _load_cached_patient_session(
    *,
    patient_id: UUID,
    session_id: str,
) -> PatientAppSession | None:
    payload = load_cached_session_hash(
        redis_client_getter=_get_patient_session_redis_client,
        logger=logger,
        scope="patient_app_session_cache",
        cache_key=_session_cache_key(session_id),
    )
    if not payload:
        return None

    cached_patient_id = decode_cached_value(payload.get("patient_id"))
    if cached_patient_id != str(patient_id):
        return None

    expires_at = parse_cached_datetime(payload.get("expires_at"))
    revoked_at = parse_cached_datetime(payload.get("revoked_at"))
    now = _now_utc()
    if expires_at is None or expires_at <= now or revoked_at is not None:
        _clear_patient_session_cache(session_id)
        return None

    last_seen_at = parse_cached_datetime(payload.get("last_seen_at")) or now
    return PatientAppSession(
        patient_id=patient_id,
        session_id=session_id,
        last_seen_at=last_seen_at,
        expires_at=expires_at,
        revoked_at=revoked_at,
    )


def _should_flush_last_seen(last_seen_at: datetime | None, now: datetime) -> bool:
    if last_seen_at is None:
        return True
    return (now - _normalize_dt(last_seen_at)).total_seconds() >= _PATIENT_SESSION_DB_FLUSH_INTERVAL_SECONDS


def register_patient_session(
    db: Session,
    *,
    patient_id: UUID,
    session_id: str,
    expires_in_seconds: int,
) -> PatientAppSession:
    now = _now_utc()
    expires_at = now + timedelta(seconds=max(int(expires_in_seconds), 1))
    existing = db.scalar(
        select(PatientAppSession).where(PatientAppSession.session_id == session_id)
    )
    if existing is None:
        existing = PatientAppSession(
            patient_id=patient_id,
            session_id=session_id,
            last_seen_at=now,
            expires_at=expires_at,
        )
    else:
        existing.patient_id = patient_id
        existing.last_seen_at = now
        existing.expires_at = expires_at
        existing.revoked_at = None
    db.add(existing)
    db.flush()
    _cache_patient_session_state(existing)
    return existing


def require_active_patient_session(
    db: Session,
    *,
    patient_id: UUID,
    session_id: str | None,
    credentials_exception: HTTPException,
) -> PatientAppSession:
    if not session_id:
        raise credentials_exception

    cached_session = _load_cached_patient_session(
        patient_id=patient_id,
        session_id=session_id,
    )
    now = _now_utc()
    if cached_session is not None:
        if _should_flush_last_seen(cached_session.last_seen_at, now):
            cached_session = None
        else:
            cached_session.last_seen_at = now
            _cache_patient_session_state(cached_session)
            return cached_session

    session = db.scalar(
        select(PatientAppSession).where(
            PatientAppSession.patient_id == patient_id,
            PatientAppSession.session_id == session_id,
        )
    )
    if session is None:
        raise credentials_exception

    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if session.revoked_at is not None or expires_at <= now:
        _clear_patient_session_cache(session_id)
        raise credentials_exception

    session.last_seen_at = now
    db.add(session)
    db.flush()
    _cache_patient_session_state(session)
    return session


def revoke_patient_session(
    db: Session,
    *,
    session_id: str | None,
) -> bool:
    if not session_id:
        return False

    session = db.scalar(
        select(PatientAppSession).where(PatientAppSession.session_id == session_id)
    )
    if session is None or session.revoked_at is not None:
        _clear_patient_session_cache(session_id)
        return False

    session.revoked_at = _now_utc()
    db.add(session)
    db.flush()
    _clear_patient_session_cache(session_id)
    return True


def revoke_patient_sessions(
    db: Session,
    *,
    patient_id: UUID,
) -> int:
    return revoke_owner_sessions(
        db,
        model=PatientAppSession,
        owner_column=PatientAppSession.patient_id,
        owner_id=patient_id,
        revoked_column=PatientAppSession.revoked_at,
        clear_session_cache=_clear_patient_session_cache,
    )


def cleanup_patient_sessions(
    db: Session,
    *,
    revoked_retention_days: int = 7,
    expired_retention_days: int = 7,
    batch_size: int = 1000,
) -> int:
    return cleanup_stale_sessions(
        db,
        model=PatientAppSession,
        revoked_column=PatientAppSession.revoked_at,
        expires_column=PatientAppSession.expires_at,
        revoked_retention_days=revoked_retention_days,
        expired_retention_days=expired_retention_days,
        batch_size=batch_size,
    )
