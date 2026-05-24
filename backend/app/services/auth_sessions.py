"""Server-side session registry helpers for staff/admin access tokens."""

import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.user_session import UserSession
from app.services.session_registry_common import (
    cleanup_stale_sessions,
    now_utc,
    normalize_dt,
    revoke_owner_sessions,
)

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 60


def _now_utc() -> datetime:
    return now_utc()


def _normalize_dt(dt: datetime) -> datetime:
    return normalize_dt(dt)


def _cache_session_state(db: Session, session: UserSession) -> None:
    """Persist session to fast unlogged cache table (shared across instances).
    
    IMPORTANT: This function does NOT commit or rollback the session.
    It executes within the caller's transaction. If the cache table does not
    exist yet (migration not run), the insert fails silently without affecting
    the outer transaction.
    """
    try:
        db.execute(
            text("""
                INSERT INTO session_cache (session_id, user_id, auth_source, expires_at, cached_at)
                VALUES (:session_id, :user_id, :auth_source, :expires_at, NOW())
                ON CONFLICT (session_id) DO UPDATE SET
                    user_id = EXCLUDED.user_id,
                    auth_source = EXCLUDED.auth_source,
                    expires_at = EXCLUDED.expires_at,
                    cached_at = NOW()
            """),
            {
                "session_id": session.session_id,
                "user_id": str(session.user_id),
                "auth_source": session.auth_source,
                "expires_at": session.expires_at,
            },
        )
    except Exception:
        # Unlogged table may not exist or be unavailable; fail silently.
        # Do NOT call db.rollback() here — it would roll back the caller's
        # entire transaction (including the UserSession write).
        pass


def _clear_session_cache(db: Session, session_id: str | None) -> None:
    if not session_id:
        return
    try:
        db.execute(
            text("DELETE FROM session_cache WHERE session_id = :session_id"),
            {"session_id": session_id},
        )
    except Exception:
        # Fail silently. Do NOT call db.rollback() here.
        pass


def _load_cached_session(
    db: Session, *, user_id: UUID, session_id: str
) -> UserSession | None:
    """Load from unlogged cache table. Returns None if miss or stale."""
    try:
        row = db.execute(
            text("""
                SELECT user_id, session_id, auth_source, expires_at, cached_at
                FROM session_cache
                WHERE session_id = :session_id
                  AND cached_at > NOW() - INTERVAL '2 minutes'
            """),
            {"session_id": session_id},
        ).mappings().fetchone()

        if row is None:
            return None

        # Verify user_id matches (security: prevent session ID collision attacks)
        if str(row["user_id"]) != str(user_id):
            return None

        now = _now_utc()
        expires_at = row["expires_at"]
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)

        if expires_at <= now:
            _clear_session_cache(db, session_id)
            return None

        return UserSession(
            user_id=UUID(str(row["user_id"])),
            session_id=row["session_id"],
            auth_source=row["auth_source"],
            expires_at=expires_at,
            last_seen_at=now,
            revoked_at=None,
        )
    except Exception:
        # Cache miss on any error; fall back to DB
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
    _cache_session_state(db, existing)
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
    _cache_session_state(db, session)
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

    cached_session = _load_cached_session(db, user_id=user_id, session_id=session_id)
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
        _clear_session_cache(db, session_id)
        raise credentials_exception

    _cache_session_state(db, session)
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
        _clear_session_cache(db, session_id)
        return False

    session.revoked_at = _now_utc()
    db.add(session)
    db.flush()
    _clear_session_cache(db, session_id)
    return True


def revoke_user_sessions(
    db: Session,
    *,
    user_id: UUID,
) -> int:
    def _clear(session_id: str | None) -> None:
        _clear_session_cache(db, session_id)

    return revoke_owner_sessions(
        db,
        model=UserSession,
        owner_column=UserSession.user_id,
        owner_id=user_id,
        revoked_column=UserSession.revoked_at,
        clear_session_cache=_clear,
    )


def cleanup_sessions(
    db: Session,
    *,
    revoked_retention_days: int = 7,
    expired_retention_days: int = 7,
    batch_size: int = 1000,
) -> int:
    # Also purge stale cache entries older than 5 minutes.
    # NOTE: Do NOT commit/rollback here — let the caller manage the transaction.
    try:
        db.execute(
            text("DELETE FROM session_cache WHERE cached_at < NOW() - INTERVAL '5 minutes'")
        )
    except Exception:
        # Cache table may not exist yet; fail silently.
        pass

    return cleanup_stale_sessions(
        db,
        model=UserSession,
        revoked_column=UserSession.revoked_at,
        expires_column=UserSession.expires_at,
        revoked_retention_days=revoked_retention_days,
        expired_retention_days=expired_retention_days,
        batch_size=batch_size,
    )
