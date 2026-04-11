"""Server-side session registry helpers for patient mobile-app tokens."""

import hashlib
import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.patient_app_session import PatientAppSession
from app.services.redis_runtime import (
    decode_cached_value,
    get_redis_client_or_log,
    log_redis_operation_failure,
    parse_cached_datetime,
)

logger = logging.getLogger(__name__)

_PATIENT_SESSION_REDIS_PREFIX = "patient_app_session:v1:"
_PATIENT_SESSION_DB_FLUSH_INTERVAL_SECONDS = 30


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_dt(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _session_cache_key(session_id: str) -> str:
    hashed = hashlib.sha256(session_id.encode("utf-8")).hexdigest()
    return f"{_PATIENT_SESSION_REDIS_PREFIX}{hashed}"


def _get_patient_session_redis_client():
    return get_redis_client_or_log(
        logger,
        scope="patient_app_session_cache",
        fallback_label="database",
    )


def _cache_patient_session_state(session: PatientAppSession) -> None:
    redis_client = _get_patient_session_redis_client()
    if redis_client is None:
        return

    expires_at = _normalize_dt(session.expires_at)
    ttl_seconds = int((expires_at - _now_utc()).total_seconds())
    cache_key = _session_cache_key(session.session_id)
    if ttl_seconds <= 0:
        try:
            redis_client.delete(cache_key)
        except Exception:
            log_redis_operation_failure(
                logger,
                scope="patient_app_session_cache",
                operation="delete_expired_entry",
                fallback_label="database",
            )
        return

    payload = {
        "patient_id": str(session.patient_id),
        "session_id": session.session_id,
        "last_seen_at": _normalize_dt(session.last_seen_at).isoformat(),
        "expires_at": expires_at.isoformat(),
    }
    if session.revoked_at is not None:
        payload["revoked_at"] = _normalize_dt(session.revoked_at).isoformat()

    try:
        redis_client.hset(cache_key, mapping=payload)
        redis_client.expire(cache_key, ttl_seconds)
    except Exception:
        log_redis_operation_failure(
            logger,
            scope="patient_app_session_cache",
            operation="write",
            fallback_label="database",
        )


def _clear_patient_session_cache(session_id: str | None) -> None:
    if not session_id:
        return
    redis_client = _get_patient_session_redis_client()
    if redis_client is None:
        return
    try:
        redis_client.delete(_session_cache_key(session_id))
    except Exception:
        log_redis_operation_failure(
            logger,
            scope="patient_app_session_cache",
            operation="delete",
            fallback_label="database",
        )


def _load_cached_patient_session(
    *,
    patient_id: UUID,
    session_id: str,
) -> PatientAppSession | None:
    redis_client = _get_patient_session_redis_client()
    if redis_client is None:
        return None

    try:
        payload = redis_client.hgetall(_session_cache_key(session_id))
    except Exception:
        log_redis_operation_failure(
            logger,
            scope="patient_app_session_cache",
            operation="read",
            fallback_label="database",
        )
        return None

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
    now = _now_utc()
    sessions = db.scalars(
        select(PatientAppSession).where(
            PatientAppSession.patient_id == patient_id,
            PatientAppSession.revoked_at.is_(None),
        )
    ).all()
    for session in sessions:
        session.revoked_at = now
        db.add(session)
    db.flush()
    for session in sessions:
        _clear_patient_session_cache(session.session_id)
    return len(sessions)


def cleanup_patient_sessions(
    db: Session,
    *,
    revoked_retention_days: int = 7,
    expired_retention_days: int = 7,
    batch_size: int = 1000,
) -> int:
    now = _now_utc()
    revoked_cutoff = now - timedelta(days=max(int(revoked_retention_days), 0))
    expired_cutoff = now - timedelta(days=max(int(expired_retention_days), 0))
    total_deleted = 0

    while True:
        stale_ids = db.scalars(
            select(PatientAppSession.id).where(
                (PatientAppSession.revoked_at.is_not(None) & (PatientAppSession.revoked_at < revoked_cutoff))
                | (PatientAppSession.revoked_at.is_(None) & (PatientAppSession.expires_at < expired_cutoff))
            ).limit(max(int(batch_size), 1))
        ).all()
        if not stale_ids:
            break

        result = db.execute(
            delete(PatientAppSession).where(PatientAppSession.id.in_(stale_ids))
        )
        db.commit()
        deleted_count = result.rowcount or 0
        total_deleted += deleted_count
        if deleted_count == 0:
            break

    return total_deleted
