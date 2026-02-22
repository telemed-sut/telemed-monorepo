import sys
import os
from datetime import datetime, timedelta, timezone

# Add the project directory to the path to import app modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import delete
from app.db.session import SessionLocal
from app.models.audit_log import AuditLog

RETENTION_DAYS = int(os.getenv("AUDIT_RETENTION_DAYS", 90))
BATCH_SIZE = int(os.getenv("AUDIT_CLEANUP_BATCH_SIZE", 1000))

def cleanup_old_audit_logs():
    """
    Deletes audit logs older than RETENTION_DAYS to conform with data retention 
    policies and reclaim database storage space.
    """
    db = SessionLocal()
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    
    print(f"Starting audit log cleanup. Cutoff Date: {cutoff_date.isoformat()} (Older than {RETENTION_DAYS} days)")
    
    total_deleted = 0
    try:
        while True:
            # Delete in distinct batches to avoid locking the database for too long
            stmt = (
                delete(AuditLog)
                .where(
                    AuditLog.id.in_(
                        db.query(AuditLog.id)
                        .filter(AuditLog.created_at < cutoff_date)
                        .limit(BATCH_SIZE)
                    )
                )
            )
            result = db.execute(stmt)
            db.commit()
            
            deleted_count = result.rowcount
            if deleted_count == 0:
                break
                
            total_deleted += deleted_count
            print(f"Deleted {deleted_count} logs... (Total so far: {total_deleted})")
            
        print(f"Cleanup complete. Successfully deleted {total_deleted} old audit logs.")
    except Exception as e:
        db.rollback()
        print(f"An error occurred during cleanup: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    cleanup_old_audit_logs()
