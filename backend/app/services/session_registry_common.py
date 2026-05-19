"""Shared helpers for server-side session registries."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from sqlalchemy import delete, select
from sqlalchemy.orm import Session


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def normalize_dt(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def revoke_owner_sessions(
    db: Session,
    *,
    model: Any,
    owner_column: Any,
    owner_id: Any,
    revoked_column: Any,
    clear_session_cache: Callable[[str | None], None],
) -> int:
    now = now_utc()
    sessions = db.scalars(
        select(model).where(owner_column == owner_id, revoked_column.is_(None))
    ).all()
    for session in sessions:
        session.revoked_at = now
        db.add(session)
    db.flush()
    for session in sessions:
        clear_session_cache(getattr(session, "session_id", None))
    return len(sessions)


def cleanup_stale_sessions(
    db: Session,
    *,
    model: Any,
    revoked_column: Any,
    expires_column: Any,
    revoked_retention_days: int = 7,
    expired_retention_days: int = 7,
    batch_size: int = 1000,
) -> int:
    now = now_utc()
    revoked_cutoff = now - timedelta(days=max(int(revoked_retention_days), 0))
    expired_cutoff = now - timedelta(days=max(int(expired_retention_days), 0))
    total_deleted = 0

    while True:
        stale_ids = db.scalars(
            select(model.id).where(
                (revoked_column.is_not(None) & (revoked_column < revoked_cutoff))
                | (revoked_column.is_(None) & (expires_column < expired_cutoff))
            ).limit(max(int(batch_size), 1))
        ).all()
        if not stale_ids:
            break

        result = db.execute(delete(model).where(model.id.in_(stale_ids)))
        db.commit()
        deleted_count = result.rowcount or 0
        total_deleted += deleted_count
        if deleted_count == 0:
            break

    return total_deleted
