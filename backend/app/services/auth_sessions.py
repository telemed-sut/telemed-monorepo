"""Server-side session registry helpers for staff/admin access tokens."""

import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.user_session import UserSession
from app.services.session_registry_common import (
    cleanup_stale_sessions,
    now_utc,
    normalize_dt,
    revoke_owner_sessions,
)

logger = logging.getLogger(__name__)

def _now_utc() -> datetime:
    return now_utc()


def _normalize_dt(dt: datetime) -> datetime:
    return normalize_dt(dt)


def _cache_session_state(session: UserSession) -> None:
    return None


def _clear_session_cache(session_id: str | None) -> None:
    return None


def _load_cached_session(*, user_id: UUID, session_id: str) -> UserSession | None:
    return None


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
    return revoke_owner_sessions(
        db,
        model=UserSession,
        owner_column=UserSession.user_id,
        owner_id=user_id,
        revoked_column=UserSession.revoked_at,
        clear_session_cache=_clear_session_cache,
    )


def cleanup_sessions(
    db: Session,
    *,
    revoked_retention_days: int = 7,
    expired_retention_days: int = 7,
    batch_size: int = 1000,
) -> int:
    return cleanup_stale_sessions(
        db,
        model=UserSession,
        revoked_column=UserSession.revoked_at,
        expires_column=UserSession.expires_at,
        revoked_retention_days=revoked_retention_days,
        expired_retention_days=expired_retention_days,
        batch_size=batch_size,
    )
