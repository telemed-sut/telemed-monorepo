from app.db.session import SessionLocal
from app.models.device_exam_session import DeviceExamSession
import sys

def main():
    db = SessionLocal()
    sessions = db.query(DeviceExamSession).filter(DeviceExamSession.status == "pending_pair").limit(5).all()
    if not sessions:
        print("NO_PENDING_SESSIONS")
        sys.exit(0)
        
    for s in sessions:
        print(f"Session: {s.id}, Device: {s.device_id}, Status: {s.status}")

if __name__ == "__main__":
    main()
