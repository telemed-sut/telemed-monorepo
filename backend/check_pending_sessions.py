import sys
import os

# Add the current directory to sys.path to allow imports from app
sys.path.append(os.getcwd())

from app.db.session import SessionLocal
from app.models.device_exam_session import DeviceExamSession
from app.models.enums import DeviceExamSessionStatus, DeviceExamSessionResolutionReason
from datetime import datetime, timezone

def cleanup():
    db = SessionLocal()
    try:
        # Find all open sessions
        open_statuses = [
            DeviceExamSessionStatus.active,
            DeviceExamSessionStatus.pending_pair,
            DeviceExamSessionStatus.stale
        ]
        sessions = db.query(DeviceExamSession).filter(DeviceExamSession.status.in_(open_statuses)).all()
        
        if not sessions:
            print("No open sessions found.")
            return

        print(f"Found {len(sessions)} open sessions. Closing them...")
        for s in sessions:
            print(f" - Closing session {s.id} for device {s.device_id}")
            s.status = DeviceExamSessionStatus.completed
            s.resolution_reason = DeviceExamSessionResolutionReason.manual_complete
            s.ended_at = datetime.now(timezone.utc)
        
        db.commit()
        print("Cleanup successful!")
    except Exception as e:
        print(f"Error: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    cleanup()
