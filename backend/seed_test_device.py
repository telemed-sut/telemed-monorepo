import sys
import uuid
from app.db.session import SessionLocal
from app.models.device_exam_session import DeviceExamSession
from app.models.device_registration import DeviceRegistration
from app.models.patient import Patient
from app.models.enums import DeviceExamMeasurementType, DeviceExamSessionStatus

def main():
    db = SessionLocal()
    
    # Ensure test_device_NEW_006 exists
    device_id = "test_device_NEW_006"
    device = db.query(DeviceRegistration).filter(DeviceRegistration.device_id == device_id).first()
    if not device:
        device = DeviceRegistration(
            device_id=device_id,
            display_name="Test Device 006",
            is_active=True,
            device_secret="k_CD6-FmznwKFCIFtZtXDlJawD3YTQonb2vMOtHFX-s"
        )
        db.add(device)
        db.commit()
    
    patient = db.query(Patient).filter(Patient.is_active == True).first()
    if not patient:
        print("NO_PATIENT")
        sys.exit(1)
        
    # check if open session exists
    session = db.query(DeviceExamSession).filter(
        DeviceExamSession.device_id == device_id,
        DeviceExamSession.status.in_([DeviceExamSessionStatus.pending_pair, DeviceExamSessionStatus.active])
    ).first()
    
    if session:
        session.status = DeviceExamSessionStatus.pending_pair
        db.add(session)
    else:
        session = DeviceExamSession(
            patient_id=patient.id,
            device_id=device.device_id,
            measurement_type=DeviceExamMeasurementType.blood_pressure,
            status=DeviceExamSessionStatus.pending_pair,
            pairing_code="PAIR1234",
            started_at=None,
        )
        db.add(session)
        
    db.commit()
    db.refresh(session)
    
    print(f"SESSION_ID={session.id}")
    print(f"DEVICE_ID={device.device_id}")
    
if __name__ == "__main__":
    main()
