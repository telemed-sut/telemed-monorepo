import sys
import uuid
import datetime
from app.db.session import SessionLocal
from app.models.device_exam_session import DeviceExamSession
from app.models.device_registration import DeviceRegistration
from app.models.patient import Patient
from app.models.enums import DeviceExamMeasurementType, DeviceExamSessionStatus

def main():
    db = SessionLocal()
    
    # 1. Get an active device
    device = db.query(DeviceRegistration).filter(DeviceRegistration.is_active == True).first()
    if not device:
        print("NO_DEVICE")
        sys.exit(1)
        
    # 2. Get a patient
    patient = db.query(Patient).filter(Patient.is_active == True).first()
    if not patient:
        print("NO_PATIENT")
        sys.exit(1)
        
    # 3. Create a pending_pair session
    session = DeviceExamSession(
        patient_id=patient.id,
        device_id=device.device_id,
        measurement_type=DeviceExamMeasurementType.blood_pressure,
        status=DeviceExamSessionStatus.pending_pair,
        pairing_code="DEMO" + str(uuid.uuid4())[:4].upper(),
        started_at=None,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    
    print(f"Created Session ID: {session.id}")
    print(f"Device ID: {device.device_id}")

if __name__ == "__main__":
    main()
