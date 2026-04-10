"""Server-side session registry helpers for staff/admin access tokens."""

from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.user_session import UserSession


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


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
        raise credentials_exception

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
        return False

    session.revoked_at = _now_utc()
    db.add(session)
    db.flush()
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
