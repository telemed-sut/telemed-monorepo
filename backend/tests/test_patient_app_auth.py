from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, object_session

from app.core.security import create_access_token, decode_token, get_password_hash, verify_password
from app.models.doctor_patient_assignment import DoctorPatientAssignment
from app.models.enums import UserRole
from app.models.patient import Patient
from app.models.patient_app_registration import PatientAppRegistration
from app.models.user import User
from app.services import patient_app as patient_app_service
from app.services import patient_app_sessions as patient_app_session_service
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


def _auth_headers(user: User, db: Session | None = None) -> dict[str, str]:
    session = db or object_session(user)
    token = create_login_response(user, db=session)["access_token"]
    session.commit()
    return {"Authorization": f"Bearer {token}"}


def _patient_headers(token: str, *, user_agent: str = "patient-app-test-agent/1.0") -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "user-agent": user_agent,
    }


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


def test_patient_app_register_rejects_phone_with_same_last_four_digits(
    client: TestClient,
    db: Session,
):
    patient = _create_patient(
        db,
        first_name="Phone",
        last_name="Suffix",
        phone="+66812345678",
    )
    registration = _create_registration_code(db, patient_id=patient.id, code="LAST44")

    response = client.post(
        "/patient-app/register",
        json={
            "phone": "+66999345678",
            "code": "LAST44",
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


def test_patient_app_login_accepts_local_phone_format_for_country_code_match(
    client: TestClient,
    db: Session,
):
    patient = _create_patient(
        db,
        first_name="Local",
        last_name="Format",
        phone="+66812345678",
        pin="2468",
    )

    response = client.post(
        "/patient-app/login",
        json={
            "phone": "0812345678",
            "pin": "2468",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["patient_id"] == str(patient.id)
    assert payload["access_token"]


def test_patient_app_login_rejects_invalid_pin(
    client: TestClient,
    db: Session,
):
    patient = _create_patient(
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
    db.refresh(patient)
    assert patient.failed_app_login_attempts == 1
    assert patient.app_account_locked_until is None


def test_patient_app_login_locks_account_after_repeated_invalid_pin_attempts(
    client: TestClient,
    db: Session,
):
    patient = _create_patient(
        db,
        first_name="Locked",
        last_name="Patient",
        phone="+66812345678",
        pin="2468",
    )

    for _ in range(patient_app_service.settings.patient_pin_max_login_attempts):
        response = client.post(
            "/patient-app/login",
            json={
                "phone": "0812345678",
                "pin": "9999",
            },
        )

    assert response.status_code == 423
    assert "temporarily locked" in response.json()["detail"].lower()

    db.refresh(patient)
    assert patient.failed_app_login_attempts == patient_app_service.settings.patient_pin_max_login_attempts
    assert patient.app_account_locked_until is not None


def test_patient_app_login_success_resets_failed_attempts(
    client: TestClient,
    db: Session,
):
    patient = _create_patient(
        db,
        first_name="Reset",
        last_name="Counter",
        phone="+66812345678",
        pin="2468",
    )
    patient.failed_app_login_attempts = 3
    patient.last_app_failed_login_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.add(patient)
    db.commit()

    response = client.post(
        "/patient-app/login",
        json={
            "phone": "0812345678",
            "pin": "2468",
        },
    )

    assert response.status_code == 200, response.text
    db.refresh(patient)
    assert patient.failed_app_login_attempts == 0
    assert patient.app_account_locked_until is None
    assert patient.last_app_failed_login_at is None


def test_patient_app_logout_revokes_current_token(
    client: TestClient,
    db: Session,
):
    patient = _create_patient(
        db,
        first_name="Logout",
        last_name="Patient",
        phone="+66812345678",
        pin="2468",
    )

    login_response = client.post(
        "/patient-app/login",
        json={
            "phone": "+66812345678",
            "pin": "2468",
        },
    )
    assert login_response.status_code == 200, login_response.text
    token = login_response.json()["access_token"]
    auth_headers = {"Authorization": f"Bearer {token}"}

    before_logout = client.get(
        "/patient-app/me/meetings",
        headers=auth_headers,
    )
    assert before_logout.status_code == 200

    logout_response = client.post(
        "/patient-app/logout",
        headers=auth_headers,
    )
    assert logout_response.status_code == 204

    after_logout = client.get(
        "/patient-app/me/meetings",
        headers=auth_headers,
    )
    assert after_logout.status_code == 401
    assert "invalid or expired token" in after_logout.json()["detail"].lower()


def test_patient_app_login_invalidates_previous_token(
    client: TestClient,
    db: Session,
):
    _create_patient(
        db,
        first_name="Session",
        last_name="Rotate",
        phone="+66812345678",
        pin="2468",
    )

    first_login = client.post(
        "/patient-app/login",
        json={
            "phone": "+66812345678",
            "pin": "2468",
        },
    )
    assert first_login.status_code == 200, first_login.text
    first_headers = {"Authorization": f"Bearer {first_login.json()['access_token']}"}

    second_login = client.post(
        "/patient-app/login",
        json={
            "phone": "+66812345678",
            "pin": "2468",
        },
    )
    assert second_login.status_code == 200, second_login.text
    second_headers = {"Authorization": f"Bearer {second_login.json()['access_token']}"}

    first_follow_up = client.get(
        "/patient-app/me/meetings",
        headers=first_headers,
    )
    assert first_follow_up.status_code == 401
    assert "invalid or expired token" in first_follow_up.json()["detail"].lower()

    second_follow_up = client.get(
        "/patient-app/me/meetings",
        headers=second_headers,
    )
    assert second_follow_up.status_code == 200
    assert second_follow_up.json()["total"] == 0


def test_patient_app_refresh_rotates_the_patient_token(
    client: TestClient,
    db: Session,
):
    _create_patient(
        db,
        first_name="Refresh",
        last_name="Rotate",
        phone="+66812345678",
        pin="2468",
    )
    login_user_agent = "patient-app-refresh-agent/1.0"

    login_response = client.post(
        "/patient-app/login",
        json={
            "phone": "+66812345678",
            "pin": "2468",
        },
        headers={"user-agent": login_user_agent},
    )
    assert login_response.status_code == 200, login_response.text
    old_token = login_response.json()["access_token"]
    old_session_id = decode_token(old_token)["session_id"]

    refresh_response = client.post(
        "/patient-app/refresh",
        headers=_patient_headers(old_token, user_agent=login_user_agent),
    )
    assert refresh_response.status_code == 200, refresh_response.text
    new_token = refresh_response.json()["access_token"]
    new_session_id = decode_token(new_token)["session_id"]
    assert new_token != old_token
    assert new_session_id != old_session_id

    old_follow_up = client.get(
        "/patient-app/me/meetings",
        headers=_patient_headers(old_token, user_agent=login_user_agent),
    )
    assert old_follow_up.status_code == 401

    new_follow_up = client.get(
        "/patient-app/me/meetings",
        headers=_patient_headers(new_token, user_agent=login_user_agent),
    )
    assert new_follow_up.status_code == 200


def test_patient_app_device_context_blocks_token_reuse_from_different_user_agent(
    client: TestClient,
    db: Session,
):
    _create_patient(
        db,
        first_name="Bound",
        last_name="Session",
        phone="+66812345678",
        pin="2468",
    )

    login_response = client.post(
        "/patient-app/login",
        json={
            "phone": "+66812345678",
            "pin": "2468",
        },
        headers={"user-agent": "patient-app-bound-agent/1.0"},
    )
    assert login_response.status_code == 200, login_response.text
    token = login_response.json()["access_token"]

    allowed_response = client.get(
        "/patient-app/me/meetings",
        headers=_patient_headers(token, user_agent="patient-app-bound-agent/1.0"),
    )
    assert allowed_response.status_code == 200

    stolen_response = client.get(
        "/patient-app/me/meetings",
        headers=_patient_headers(token, user_agent="curl/8.7.1"),
    )
    assert stolen_response.status_code == 401
    assert "original device context" in stolen_response.json()["detail"].lower()


def test_patient_app_rejects_legacy_tokens_without_device_context(
    client: TestClient,
    db: Session,
):
    patient = _create_patient(
        db,
        first_name="Legacy",
        last_name="Token",
        phone="+66812345678",
        pin="2468",
    )
    legacy_session_id = "legacy-patient-session"
    patient_app_session_service.register_patient_session(
        db,
        patient_id=patient.id,
        session_id=legacy_session_id,
        expires_in_seconds=patient_app_service.settings.patient_app_token_ttl_seconds,
    )
    legacy_token = create_access_token(
        {
            "sub": str(patient.id),
            "type": "patient",
            "role": "patient",
            "session_id": legacy_session_id,
        },
        expires_in=patient_app_service.settings.patient_app_token_ttl_seconds,
    )
    db.commit()

    response = client.get(
        "/patient-app/me/meetings",
        headers=_patient_headers(legacy_token, user_agent="legacy-agent/1.0"),
    )

    assert response.status_code == 401
    assert "re-authenticated" in response.json()["detail"].lower()


def test_patient_app_logout_requires_matching_device_context(
    client: TestClient,
    db: Session,
):
    _create_patient(
        db,
        first_name="Logout",
        last_name="Bound",
        phone="+66812345678",
        pin="2468",
    )

    login_response = client.post(
        "/patient-app/login",
        json={
            "phone": "+66812345678",
            "pin": "2468",
        },
        headers={"user-agent": "patient-app-logout-agent/1.0"},
    )
    assert login_response.status_code == 200, login_response.text
    token = login_response.json()["access_token"]

    forced_logout = client.post(
        "/patient-app/logout",
        headers=_patient_headers(token, user_agent="curl/8.7.1"),
    )
    assert forced_logout.status_code == 401
    assert "original device context" in forced_logout.json()["detail"].lower()

    follow_up = client.get(
        "/patient-app/me/meetings",
        headers=_patient_headers(token, user_agent="patient-app-logout-agent/1.0"),
    )
    assert follow_up.status_code == 200


def test_patient_app_logout_all_revokes_all_active_sessions(
    client: TestClient,
    db: Session,
):
    patient = _create_patient(
        db,
        first_name="Logout",
        last_name="All",
        phone="+66812345678",
        pin="2468",
    )

    primary_login = client.post(
        "/patient-app/login",
        json={
            "phone": "+66812345678",
            "pin": "2468",
        },
        headers={"user-agent": "patient-app-primary-agent/1.0"},
    )
    assert primary_login.status_code == 200, primary_login.text
    primary_token = primary_login.json()["access_token"]

    secondary_session_id = "secondary-patient-session"
    secondary_context = patient_app_service.build_patient_device_context(
        user_agent="patient-app-secondary-agent/1.0",
        device_id=None,
    )
    patient_app_session_service.register_patient_session(
        db,
        patient_id=patient.id,
        session_id=secondary_session_id,
        expires_in_seconds=patient_app_service.settings.patient_app_token_ttl_seconds,
    )
    secondary_token = create_access_token(
        {
            "sub": str(patient.id),
            "type": "patient",
            "role": "patient",
            "session_id": secondary_session_id,
            "device_ctx": secondary_context,
        },
        expires_in=patient_app_service.settings.patient_app_token_ttl_seconds,
    )
    db.commit()

    logout_all_response = client.post(
        "/patient-app/logout-all",
        headers=_patient_headers(primary_token, user_agent="patient-app-primary-agent/1.0"),
    )
    assert logout_all_response.status_code == 204

    primary_follow_up = client.get(
        "/patient-app/me/meetings",
        headers=_patient_headers(primary_token, user_agent="patient-app-primary-agent/1.0"),
    )
    assert primary_follow_up.status_code == 401

    secondary_follow_up = client.get(
        "/patient-app/me/meetings",
        headers=_patient_headers(secondary_token, user_agent="patient-app-secondary-agent/1.0"),
    )
    assert secondary_follow_up.status_code == 401


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
