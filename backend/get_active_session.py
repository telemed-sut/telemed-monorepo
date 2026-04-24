import sys
import json
from app.db.session import SessionLocal
from app.models.device_exam_session import DeviceExamSession
from app.models.device_registration import DeviceRegistration
from app.models.enums import DeviceExamSessionStatus

def main():
    db = SessionLocal()
    
    session = db.query(DeviceExamSession).filter(DeviceExamSession.status.in_([DeviceExamSessionStatus.pending_pair, DeviceExamSessionStatus.active])).first()
    if not session:
        print("NO_OPEN_SESSION")
        sys.exit(0)
        
    device = db.query(DeviceRegistration).filter(DeviceRegistration.device_id == session.device_id).first()
    
    print("SESSION_ID=" + str(session.id))
    print("DEVICE_ID=" + str(session.device_id))
    print("MEASUREMENT_TYPE=" + session.measurement_type.value)
    print("STATUS=" + session.status.value)
    
if __name__ == "__main__":
    main()
