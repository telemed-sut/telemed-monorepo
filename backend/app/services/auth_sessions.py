"""Server-side session registry helpers for staff/admin access tokens."""

import hashlib
import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.user_session import UserSession
from app.services.redis_runtime import (
    decode_cached_value,
    get_redis_client_or_log,
    log_redis_operation_failure,
    parse_cached_datetime,
)

logger = logging.getLogger(__name__)

_USER_SESSION_REDIS_PREFIX = "user_session:v1:"


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_dt(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _session_cache_key(session_id: str) -> str:
    hashed = hashlib.sha256(session_id.encode("utf-8")).hexdigest()
    return f"{_USER_SESSION_REDIS_PREFIX}{hashed}"


def _get_session_redis_client():
    return get_redis_client_or_log(
        logger,
        scope="user_session_cache",
        fallback_label="database",
    )


def _cache_session_state(session: UserSession) -> None:
    redis_client = _get_session_redis_client()
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
                scope="user_session_cache",
                operation="delete_expired_entry",
                fallback_label="database",
            )
        return

    payload = {
        "user_id": str(session.user_id),
        "session_id": session.session_id,
        "auth_source": session.auth_source,
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
            scope="user_session_cache",
            operation="write",
            fallback_label="database",
        )


def _clear_session_cache(session_id: str | None) -> None:
    if not session_id:
        return
    redis_client = _get_session_redis_client()
    if redis_client is None:
        return
    try:
        redis_client.delete(_session_cache_key(session_id))
    except Exception:
        log_redis_operation_failure(
            logger,
            scope="user_session_cache",
            operation="delete",
            fallback_label="database",
        )


def _load_cached_session(*, user_id: UUID, session_id: str) -> UserSession | None:
    redis_client = _get_session_redis_client()
    if redis_client is None:
        return None

    try:
        payload = redis_client.hgetall(_session_cache_key(session_id))
    except Exception:
        log_redis_operation_failure(
            logger,
            scope="user_session_cache",
            operation="read",
            fallback_label="database",
        )
        return None

    if not payload:
        return None

    cached_user_id = decode_cached_value(payload.get("user_id"))
    if cached_user_id != str(user_id):
        return None

    expires_at = parse_cached_datetime(payload.get("expires_at"))
    revoked_at = parse_cached_datetime(payload.get("revoked_at"))
    now = _now_utc()
    if expires_at is None or expires_at <= now or revoked_at is not None:
        _clear_session_cache(session_id)
        return None

    last_seen_at = parse_cached_datetime(payload.get("last_seen_at")) or now
    return UserSession(
        user_id=user_id,
        session_id=session_id,
        auth_source=decode_cached_value(payload.get("auth_source")) or "local",
        last_seen_at=last_seen_at,
        expires_at=expires_at,
        revoked_at=revoked_at,
    )


def register_session(
    db: Session,
    *,
    user_id: UUID,
    session_id: str,
    auth_source: str,
    expires_in_seconds: int,
) -> UserSession:
    now = _now_utc()
    expires_at = now + timedelta(seconds=max(int(expires_in_seconds), 1))
    existing = db.scalar(
        select(UserSession).where(UserSession.session_id == session_id)
    )
    if existing is None:
        existing = UserSession(
            user_id=user_id,
            session_id=session_id,
            auth_source=auth_source,
            last_seen_at=now,
            expires_at=expires_at,
        )
    else:
        existing.user_id = user_id
        existing.auth_source = auth_source
        existing.last_seen_at = now
        existing.expires_at = expires_at
        existing.revoked_at = None
    db.add(existing)
    db.flush()
    _cache_session_state(existing)
    return existing


def touch_session(
    db: Session,
    *,
    user_id: UUID,
    session_id: str,
    expires_in_seconds: int,
) -> UserSession | None:
    session = db.scalar(
        select(UserSession).where(
            UserSession.user_id == user_id,
            UserSession.session_id == session_id,
        )
    )
    if session is None:
        return None

    now = _now_utc()
    session.last_seen_at = now
    session.expires_at = now + timedelta(seconds=max(int(expires_in_seconds), 1))
    db.add(session)
    db.flush()
    _cache_session_state(session)
    return session


def require_active_session(
    db: Session,
    *,
    user_id: UUID,
    session_id: str | None,
    credentials_exception: HTTPException,
) -> UserSession:
    if not session_id:
        raise credentials_exception

    cached_session = _load_cached_session(user_id=user_id, session_id=session_id)
    if cached_session is not None:
        return cached_session

    session = db.scalar(
        select(UserSession).where(
            UserSession.user_id == user_id,
            UserSession.session_id == session_id,
        )
    )
    if session is None:
        raise credentials_exception

    now = _now_utc()
    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if session.revoked_at is not None or expires_at <= now:
        _clear_session_cache(session_id)
        raise credentials_exception

    _cache_session_state(session)
    return session


def revoke_session(
    db: Session,
    *,
    session_id: str | None,
) -> bool:
    if not session_id:
        return False

    session = db.scalar(
        select(UserSession).where(UserSession.session_id == session_id)
    )
    if session is None or session.revoked_at is not None:
        _clear_session_cache(session_id)
        return False

    session.revoked_at = _now_utc()
    db.add(session)
    db.flush()
    _clear_session_cache(session_id)
    return True


def revoke_user_sessions(
    db: Session,
    *,
    user_id: UUID,
) -> int:
    now = _now_utc()
    sessions = db.scalars(
        select(UserSession).where(
            UserSession.user_id == user_id,
            UserSession.revoked_at.is_(None),
        )
    ).all()
    for session in sessions:
        session.revoked_at = now
        db.add(session)
    db.flush()
    for session in sessions:
        _clear_session_cache(session.session_id)
    return len(sessions)


def cleanup_sessions(
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
            select(UserSession.id).where(
                (UserSession.revoked_at.is_not(None) & (UserSession.revoked_at < revoked_cutoff))
                | (UserSession.revoked_at.is_(None) & (UserSession.expires_at < expired_cutoff))
            ).limit(max(int(batch_size), 1))
        ).all()
        if not stale_ids:
            break

        result = db.execute(
            delete(UserSession).where(UserSession.id.in_(stale_ids))
        )
        db.commit()
        deleted_count = result.rowcount or 0
        total_deleted += deleted_count
        if deleted_count == 0:
            break

    return total_deleted
