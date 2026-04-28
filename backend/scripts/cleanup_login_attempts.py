import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import delete

from app.db.session import SessionLocal
from app.models.login_attempt import LoginAttempt

RETENTION_DAYS = int(os.getenv("LOGIN_ATTEMPT_RETENTION_DAYS", 90))
BATCH_SIZE = int(os.getenv("LOGIN_ATTEMPT_CLEANUP_BATCH_SIZE", 1000))


def cleanup_old_login_attempts(*, retention_days: int = RETENTION_DAYS, batch_size: int = BATCH_SIZE) -> int:
    """Delete login-attempt records older than the configured retention window."""

    db = SessionLocal()
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=retention_days)
    total_deleted = 0

    print(
        "Starting login attempt cleanup. "
        f"Cutoff Date: {cutoff_date.isoformat()} (Older than {retention_days} days)"
    )

    try:
        while True:
            stmt = (
                delete(LoginAttempt)
                .where(
                    LoginAttempt.id.in_(
                        db.query(LoginAttempt.id)
                        .filter(LoginAttempt.created_at < cutoff_date)
                        .limit(batch_size)
                    )
                )
            )
            result = db.execute(stmt)
            db.commit()

            deleted_count = result.rowcount
            if deleted_count == 0:
                break

            total_deleted += deleted_count
            print(
                f"Deleted {deleted_count} login attempts... "
                f"(Total so far: {total_deleted})"
            )

        print(
            "Cleanup complete. "
            f"Successfully deleted {total_deleted} old login attempts."
        )
        return total_deleted
    except Exception as exc:
        db.rollback()
        print(f"An error occurred during cleanup: {exc}", file=sys.stderr)
        raise
    finally:
        db.close()


def main() -> int:
    try:
        cleanup_old_login_attempts()
        return 0
    except Exception:
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
