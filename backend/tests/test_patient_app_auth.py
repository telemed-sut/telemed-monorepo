from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_password_hash, verify_password
from app.models.doctor_patient_assignment import DoctorPatientAssignment
from app.models.enums import UserRole
from app.models.patient import Patient
from app.models.patient_app_registration import PatientAppRegistration
from app.models.user import User
from app.services.auth import create_login_response


def _create_patient(
    db: Session,
    *,
    first_name: str = "Patient",
    last_name: str = "App",
    phone: str = "+66812345678",
    pin: str | None = None,
) -> Patient:
    patient = Patient(
        first_name=first_name,
        last_name=last_name,
        phone=phone,
        date_of_birth=date(1990, 1, 1),
        pin_hash=get_password_hash(pin) if pin else None,
    )
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


def _create_registration_code(
    db: Session,
    *,
    patient_id,
    code: str = "ABCD23",
    expires_at: datetime | None = None,
) -> PatientAppRegistration:
    registration = PatientAppRegistration(
        patient_id=patient_id,
        code=code,
        expires_at=expires_at or (datetime.now(timezone.utc) + timedelta(hours=24)),
    )
    db.add(registration)
    db.commit()
    db.refresh(registration)
    return registration


def _create_user(
    db: Session,
    *,
    email: str,
    role: UserRole,
) -> User:
    user = User(
        email=email,
        password_hash=get_password_hash("TestPass123"),
        role=role,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _assign_doctor(db: Session, *, doctor_id, patient_id) -> None:
    db.add(
        DoctorPatientAssignment(
            doctor_id=doctor_id,
            patient_id=patient_id,
            role="primary",
        )
    )
    db.commit()


def _auth_headers(user: User) -> dict[str, str]:
    token = create_login_response(user)["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_patient_app_register_sets_pin_and_consumes_code(
    client: TestClient,
    db: Session,
):
    patient = _create_patient(
        db,
        first_name="Register",
        last_name="Success",
        phone="+66812345678",
    )
    registration = _create_registration_code(db, patient_id=patient.id, code="ABCD23")

    response = client.post(
        "/patient-app/register",
        json={
            "phone": "0812345678",
            "code": "abcd23",
            "pin": "123456",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["patient_id"] == str(patient.id)
    assert payload["token_type"] == "bearer"
    assert payload["expires_in"] > 0
    assert payload["patient_name"] == "Register Success"
    assert payload["access_token"]

    db.refresh(patient)
    db.refresh(registration)
    assert patient.pin_hash is not None
    assert verify_password("123456", patient.pin_hash)
    assert patient.app_registered_at is not None
    assert registration.is_used is True
    assert registration.used_at is not None


def test_patient_app_register_rejects_expired_code(
    client: TestClient,
    db: Session,
):
    patient = _create_patient(db, first_name="Expired", last_name="Code")
    registration = _create_registration_code(
        db,
        patient_id=patient.id,
        code="ZXCV45",
        expires_at=datetime.now(timezone.utc) - timedelta(minutes=5),
    )

    response = client.post(
        "/patient-app/register",
        json={
            "phone": "0812345678",
            "code": "ZXCV45",
            "pin": "1234",
        },
    )

    assert response.status_code == 401
    assert "expired" in response.json()["detail"].lower()
    db.refresh(registration)
    assert registration.is_used is False


def test_patient_app_register_rejects_phone_mismatch_without_consuming_code(
    client: TestClient,
    db: Session,
):
    patient = _create_patient(db, first_name="Phone", last_name="Mismatch")
    registration = _create_registration_code(db, patient_id=patient.id, code="QWER67")

    response = client.post(
        "/patient-app/register",
        json={
            "phone": "0899999999",
            "code": "QWER67",
            "pin": "1234",
        },
    )

    assert response.status_code == 401
    assert "phone number does not match" in response.json()["detail"].lower()
    db.refresh(registration)
    assert registration.is_used is False


def test_patient_app_login_accepts_registered_patient_pin(
    client: TestClient,
    db: Session,
):
    patient = _create_patient(
        db,
        first_name="Login",
        last_name="Success",
        phone="+66812345678",
        pin="2468",
    )

    response = client.post(
        "/patient-app/login",
        json={
            "phone": "+66812345678",
            "pin": "2468",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["patient_id"] == str(patient.id)
    assert payload["token_type"] == "bearer"
    assert payload["expires_in"] > 0
    assert payload["patient_name"] == "Login Success"
    assert payload["access_token"]


def test_patient_app_login_rejects_invalid_pin(
    client: TestClient,
    db: Session,
):
    _create_patient(
        db,
        first_name="Bad",
        last_name="Pin",
        phone="+66812345678",
        pin="2468",
    )

    response = client.post(
        "/patient-app/login",
        json={
            "phone": "0812345678",
            "pin": "9999",
        },
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid phone number or PIN."


def test_admin_can_generate_patient_app_registration_code(
    client: TestClient,
    db: Session,
):
    admin = _create_user(db, email="patient-app-admin@example.com", role=UserRole.admin)
    patient = _create_patient(
        db,
        first_name="Code",
        last_name="Admin",
        phone="+66812345678",
    )

    response = client.post(
        f"/patient-app/{patient.id}/code",
        headers=_auth_headers(admin),
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["patient_id"] == str(patient.id)
    assert len(payload["code"]) == 6
    assert payload["expires_at"]

    registration = db.scalar(
        select(PatientAppRegistration)
        .where(PatientAppRegistration.patient_id == patient.id)
        .order_by(PatientAppRegistration.created_at.desc())
    )
    assert registration is not None
    assert registration.code == payload["code"]
    assert registration.created_by == admin.id
    assert registration.is_used is False


def test_assigned_doctor_can_generate_code_and_invalidate_previous_unused_code(
    client: TestClient,
    db: Session,
):
    doctor = _create_user(db, email="patient-app-doctor@example.com", role=UserRole.doctor)
    patient = _create_patient(
        db,
        first_name="Code",
        last_name="Doctor",
        phone="+66812345679",
    )
    _assign_doctor(db, doctor_id=doctor.id, patient_id=patient.id)
    previous = _create_registration_code(db, patient_id=patient.id, code="ZXCV45")

    response = client.post(
        f"/patient-app/{patient.id}/code",
        headers=_auth_headers(doctor),
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["patient_id"] == str(patient.id)
    assert payload["code"] != previous.code

    db.refresh(previous)
    assert previous.is_used is True
    assert previous.used_at is not None

    registrations = db.scalars(
        select(PatientAppRegistration).where(PatientAppRegistration.patient_id == patient.id)
    ).all()
    assert len(registrations) == 2
    new_registration = next(reg for reg in registrations if reg.code == payload["code"])
    assert new_registration.created_by == doctor.id
    assert new_registration.is_used is False


def test_medical_student_cannot_generate_patient_app_registration_code(
    client: TestClient,
    db: Session,
):
    medical_student = _create_user(
        db,
        email="patient-app-medical-student@example.com",
        role=UserRole.medical_student,
    )
    patient = _create_patient(db, first_name="Code", last_name="Denied", phone="+66812345670")

    response = client.post(
        f"/patient-app/{patient.id}/code",
        headers=_auth_headers(medical_student),
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Access denied"


def test_generate_patient_app_code_returns_not_found_for_missing_patient(
    client: TestClient,
    db: Session,
):
    admin = _create_user(db, email="patient-app-missing@example.com", role=UserRole.admin)

    response = client.post(
        f"/patient-app/{uuid4()}/code",
        headers=_auth_headers(admin),
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Patient not found."
