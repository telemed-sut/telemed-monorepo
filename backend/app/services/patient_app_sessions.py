"""Server-side session registry helpers for patient mobile-app tokens."""

from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.patient_app_session import PatientAppSession


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


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

    session = db.scalar(
        select(PatientAppSession).where(
            PatientAppSession.patient_id == patient_id,
            PatientAppSession.session_id == session_id,
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

    session.last_seen_at = now
    db.add(session)
    db.flush()
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
        return False

    session.revoked_at = _now_utc()
    db.add(session)
    db.flush()
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
