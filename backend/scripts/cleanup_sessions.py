#!/usr/bin/env python3
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.session import SessionLocal
from app.services import auth_sessions, patient_app_sessions

REVOKED_RETENTION_DAYS = int(os.getenv("SESSION_REVOKED_RETENTION_DAYS", 7))
EXPIRED_RETENTION_DAYS = int(os.getenv("SESSION_EXPIRED_RETENTION_DAYS", 7))
BATCH_SIZE = int(os.getenv("SESSION_CLEANUP_BATCH_SIZE", 1000))


def cleanup_sessions(
    *,
    revoked_retention_days: int = REVOKED_RETENTION_DAYS,
    expired_retention_days: int = EXPIRED_RETENTION_DAYS,
    batch_size: int = BATCH_SIZE,
) -> dict[str, int]:
    db = SessionLocal()
    try:
        deleted_user_sessions = auth_sessions.cleanup_sessions(
            db,
            revoked_retention_days=revoked_retention_days,
            expired_retention_days=expired_retention_days,
            batch_size=batch_size,
        )
        deleted_patient_sessions = patient_app_sessions.cleanup_patient_sessions(
            db,
            revoked_retention_days=revoked_retention_days,
            expired_retention_days=expired_retention_days,
            batch_size=batch_size,
        )
        return {
            "user_sessions": deleted_user_sessions,
            "patient_app_sessions": deleted_patient_sessions,
        }
    finally:
        db.close()


def main() -> int:
    try:
        summary = cleanup_sessions()
        print(
            "Session cleanup complete. "
            f"user_sessions={summary['user_sessions']}, "
            f"patient_app_sessions={summary['patient_app_sessions']}"
        )
        return 0
    except Exception as exc:
        print(f"Session cleanup failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
