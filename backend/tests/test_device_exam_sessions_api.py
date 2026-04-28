from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models.device_registration import DeviceRegistration
from app.models.device_exam_session import DeviceExamSession
from app.models.doctor_patient_assignment import DoctorPatientAssignment
from app.models.enums import DeviceExamSessionStatus, UserRole
from app.models.patient import Patient
from app.models.user import User
from app.services.auth import create_login_response


def _create_user(db: Session, *, email: str, role: UserRole) -> User:
    user = User(
        email=email,
        password_hash=get_password_hash("password"),
        role=role,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _auth_headers(user: User, db: Session) -> dict[str, str]:
    response = create_login_response(user, db=db)
    db.commit()
    return {"Authorization": f"Bearer {response['access_token']}"}


def _create_patient(db: Session) -> Patient:
    patient = Patient(
        first_name="Device",
        last_name="Session",
        date_of_birth=date(1990, 1, 1),
    )
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


def _assign_doctor(db: Session, *, doctor: User, patient: Patient) -> None:
    assignment = DoctorPatientAssignment(
        doctor_id=doctor.id,
        patient_id=patient.id,
        role="primary",
    )
    db.add(assignment)
    db.commit()


def _register_device(db: Session, *, device_id: str) -> DeviceRegistration:
    device = DeviceRegistration(
        device_id=device_id,
        display_name=f"Device {device_id}",
        notes="test device",
        is_active=True,
    )
    device.device_secret = "device-secret-1234567890"
    db.add(device)
    db.commit()
    db.refresh(device)
    return device


def test_doctor_can_create_and_complete_device_exam_session(client: TestClient, db: Session):
    doctor = _create_user(db, email="doctor-device-session@example.com", role=UserRole.doctor)
    patient = _create_patient(db)
    _assign_doctor(db, doctor=doctor, patient=patient)
    _register_device(db, device_id="lung-ward-01")

    create_response = client.post(
        "/device-sessions",
        json={
            "patient_id": str(patient.id),
            "device_id": "lung-ward-01",
            "measurement_type": "lung_sound",
            "notes": "first session",
            "activate_now": True,
        },
        headers=_auth_headers(doctor, db),
    )
    assert create_response.status_code == 201, create_response.text
    created = create_response.json()
    assert created["device_id"] == "lung-ward-01"
    assert created["status"] == "active"
    assert created["pairing_code"]

    active_response = client.get(
        "/device-sessions/by-device/lung-ward-01/active",
        headers=_auth_headers(doctor, db),
    )
    assert active_response.status_code == 200
    assert active_response.json()["id"] == created["id"]

    complete_response = client.post(
        f"/device-sessions/{created['id']}/complete",
        json={"notes": "completed cleanly"},
        headers=_auth_headers(doctor, db),
    )
    assert complete_response.status_code == 200, complete_response.text
    completed = complete_response.json()
    assert completed["status"] == "completed"
    assert completed["ended_at"] is not None


def test_creating_second_session_preempts_existing_open_session(client: TestClient, db: Session):
    doctor = _create_user(db, email="doctor-device-conflict@example.com", role=UserRole.doctor)
    patient_one = _create_patient(db)
    patient_two = Patient(
        first_name="Another",
        last_name="Patient",
        date_of_birth=date(1992, 2, 2),
    )
    db.add(patient_two)
    db.commit()
    db.refresh(patient_two)
    _assign_doctor(db, doctor=doctor, patient=patient_one)
    _assign_doctor(db, doctor=doctor, patient=patient_two)
    _register_device(db, device_id="lung-ward-02")

    first_response = client.post(
        "/device-sessions",
        json={
            "patient_id": str(patient_one.id),
            "device_id": "lung-ward-02",
            "measurement_type": "lung_sound",
        },
        headers=_auth_headers(doctor, db),
    )
    assert first_response.status_code == 201, first_response.text

    second_response = client.post(
        "/device-sessions",
        json={
            "patient_id": str(patient_two.id),
            "device_id": "lung-ward-02",
            "measurement_type": "lung_sound",
        },
        headers=_auth_headers(doctor, db),
    )
    assert second_response.status_code == 201, second_response.text
    created = second_response.json()
    assert created["patient_id"] == str(patient_two.id)
    assert created["status"] == "active"

    previous_session = db.query(DeviceExamSession).filter(DeviceExamSession.patient_id == patient_one.id).one()
    db.refresh(previous_session)
    assert previous_session.status == DeviceExamSessionStatus.review_needed
    assert previous_session.ended_at is not None
    assert previous_session.resolution_reason.value == "preempted_by_new_session"


def test_doctor_can_activate_heartbeat_and_cancel_device_exam_session(client: TestClient, db: Session):
    doctor = _create_user(db, email="doctor-device-lifecycle@example.com", role=UserRole.doctor)
    patient = _create_patient(db)
    _assign_doctor(db, doctor=doctor, patient=patient)
    _register_device(db, device_id="lung-ward-03")

    create_response = client.post(
        "/device-sessions",
        json={
            "patient_id": str(patient.id),
            "device_id": "lung-ward-03",
            "measurement_type": "lung_sound",
            "activate_now": False,
        },
        headers=_auth_headers(doctor, db),
    )
    assert create_response.status_code == 201, create_response.text
    created = create_response.json()
    assert created["status"] == "pending_pair"

    activate_response = client.post(
        f"/device-sessions/{created['id']}/activate",
        headers=_auth_headers(doctor, db),
    )
    assert activate_response.status_code == 200, activate_response.text
    activated = activate_response.json()
    assert activated["status"] == "active"
    assert activated["started_at"] is not None

    heartbeat_response = client.post(
        f"/device-sessions/{created['id']}/heartbeat",
        headers=_auth_headers(doctor, db),
    )
    assert heartbeat_response.status_code == 200, heartbeat_response.text
    heartbeat = heartbeat_response.json()
    assert heartbeat["status"] == "active"
    assert heartbeat["last_seen_at"] is not None

    cancel_response = client.post(
        f"/device-sessions/{created['id']}/cancel",
        json={"notes": "patient rescheduled"},
        headers=_auth_headers(doctor, db),
    )
    assert cancel_response.status_code == 200, cancel_response.text
    cancelled = cancel_response.json()
    assert cancelled["status"] == "cancelled"
    assert cancelled["ended_at"] is not None
    assert cancelled["notes"] == "patient rescheduled"


def test_unassigned_doctor_cannot_access_another_patients_device_session(client: TestClient, db: Session):
    owner_doctor = _create_user(db, email="doctor-device-owner@example.com", role=UserRole.doctor)
    other_doctor = _create_user(db, email="doctor-device-other@example.com", role=UserRole.doctor)
    patient = _create_patient(db)
    _assign_doctor(db, doctor=owner_doctor, patient=patient)
    _register_device(db, device_id="lung-ward-04")

    create_response = client.post(
        "/device-sessions",
        json={
            "patient_id": str(patient.id),
            "device_id": "lung-ward-04",
            "measurement_type": "lung_sound",
            "activate_now": True,
        },
        headers=_auth_headers(owner_doctor, db),
    )
    assert create_response.status_code == 201, create_response.text
    session_id = create_response.json()["id"]

    unauthorized_response = client.get(
        f"/device-sessions/{session_id}",
        headers=_auth_headers(other_doctor, db),
    )
    assert unauthorized_response.status_code == 403, unauthorized_response.text
