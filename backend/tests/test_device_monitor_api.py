from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, object_session

from app.core.security import get_password_hash
from app.models.device_error_log import DeviceErrorLog
from app.models.enums import UserRole
from app.models.patient import Patient
from app.models.pressure_record import PressureRecord
from app.models.user import User
from app.services.auth import create_login_response


def _create_user(db: Session, *, email: str, role: UserRole) -> User:
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


def _auth_headers(user: User, db: Session | None = None) -> dict[str, str]:
    session = db or object_session(user)
    token = create_login_response(user, db=session)["access_token"]
    session.commit()
    return {"Authorization": f"Bearer {token}"}


def _create_patient(db: Session) -> Patient:
    patient = Patient(
        first_name="Device",
        last_name="Monitor",
        date_of_birth=date(1991, 2, 2),
    )
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


def test_device_health_endpoint_is_public(client: TestClient):
    response = client.get("/device/v1/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["timestamp"]


def test_device_stats_requires_admin_role(client: TestClient, db: Session):
    medical_student = _create_user(db, email="device-medical-student@example.com", role=UserRole.medical_student)

    response = client.get("/device/v1/stats", headers=_auth_headers(medical_student, db))

    assert response.status_code == 403


def test_device_stats_returns_counts_and_top_devices(
    client: TestClient,
    db: Session,
):
    admin = _create_user(db, email="device-admin@example.com", role=UserRole.admin)
    patient = _create_patient(db)
    now = datetime.now(timezone.utc)

    db.add_all(
        [
            PressureRecord(
                patient_id=patient.id,
                device_id="monitor-001",
                heart_rate=80,
                sys_rate=120,
                dia_rate=80,
                measured_at=now - timedelta(minutes=20),
            ),
            PressureRecord(
                patient_id=patient.id,
                device_id="monitor-001",
                heart_rate=82,
                sys_rate=122,
                dia_rate=81,
                measured_at=now - timedelta(minutes=10),
            ),
            DeviceErrorLog(
                device_id="monitor-001",
                error_message="AUTH_FAILED:invalid_signature",
                ip_address="127.0.0.1",
                endpoint="/device/v1/pressure",
                occurred_at=now - timedelta(minutes=15),
            ),
            DeviceErrorLog(
                device_id="monitor-002",
                error_message="HTTP 404: user not found",
                ip_address="127.0.0.2",
                endpoint="/device/v1/pressure",
                occurred_at=now - timedelta(minutes=5),
            ),
        ]
    )
    db.commit()

    response = client.get(
        "/device/v1/stats?hours=24&top_devices=5",
        headers=_auth_headers(admin, db),
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["success_count"] == 2
    assert payload["error_count"] == 2
    assert payload["error_rate"] == 0.5
    assert payload["period_hours"] >= 1
    assert len(payload["errors_by_device"]) == 2
    assert {"device_id": "monitor-001", "count": 1} in payload["errors_by_device"]
    assert {"device_id": "monitor-002", "count": 1} in payload["errors_by_device"]


def test_device_errors_requires_admin_role(client: TestClient, db: Session):
    doctor = _create_user(db, email="device-doctor@example.com", role=UserRole.doctor)

    response = client.get("/device/v1/errors", headers=_auth_headers(doctor))

    assert response.status_code == 403


def test_device_errors_returns_serialized_hints_and_filters(
    client: TestClient,
    db: Session,
):
    admin = _create_user(db, email="device-errors-admin@example.com", role=UserRole.admin)
    now = datetime.now(timezone.utc)
    db.add_all(
        [
            DeviceErrorLog(
                device_id="monitor-filter",
                error_message="AUTH_FAILED:invalid_signature",
                ip_address="127.0.0.1",
                endpoint="/device/v1/pressure",
                occurred_at=now - timedelta(minutes=2),
            ),
            DeviceErrorLog(
                device_id="monitor-other",
                error_message="HTTP 404: patient not found",
                ip_address="127.0.0.2",
                endpoint="/device/v1/pressure",
                occurred_at=now - timedelta(minutes=1),
            ),
        ]
    )
    db.commit()

    response = client.get(
        "/device/v1/errors?device_id=monitor-filter&limit=10",
        headers=_auth_headers(admin),
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["device_id"] == "monitor-filter"
    assert payload[0]["error_code"] == "invalid_signature"
    assert "HMAC" in payload[0]["suggestion"]
