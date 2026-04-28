from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, object_session

from app.core.security import get_password_hash
from app.models.device_exam_session import DeviceExamSession
from app.models.device_error_log import DeviceErrorLog
from app.models.device_registration import DeviceRegistration
from app.models.doctor_patient_assignment import DoctorPatientAssignment
from app.models.enums import (
    DeviceExamMeasurementType,
    DeviceExamSessionStatus,
    DeviceMeasurementRoutingStatus,
    UserRole,
)
from app.models.patient import Patient
from app.models.pressure_record import PressureRecord
from app.models.lung_sound_record import LungSoundRecord
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


def _assign_doctor(db: Session, *, doctor: User, patient: Patient) -> None:
    assignment = DoctorPatientAssignment(
        doctor_id=doctor.id,
        patient_id=patient.id,
        role="primary",
    )
    db.add(assignment)
    db.commit()


def _register_device(db: Session, *, device_id: str, display_name: str) -> DeviceRegistration:
    device = DeviceRegistration(
        device_id=device_id,
        display_name=display_name,
        default_measurement_type=DeviceExamMeasurementType.lung_sound,
        is_active=True,
    )
    device.device_secret = "monitor-device-secret"
    db.add(device)
    db.commit()
    db.refresh(device)
    return device


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


def test_live_device_sessions_returns_freshness_and_device_context_for_admin(
    client: TestClient,
    db: Session,
):
    admin = _create_user(db, email="device-live-admin@example.com", role=UserRole.admin)
    patient = _create_patient(db)
    _register_device(db, device_id="monitor-live-001", display_name="Lung Cart A")
    now = datetime.now(timezone.utc)
    session = DeviceExamSession(
        patient_id=patient.id,
        device_id="monitor-live-001",
        measurement_type=DeviceExamMeasurementType.lung_sound,
        status=DeviceExamSessionStatus.active,
        pairing_code="LIVE01",
        started_at=now - timedelta(minutes=5),
        last_seen_at=now - timedelta(minutes=4),
    )
    db.add(session)
    db.commit()

    response = client.get(
        "/device/v1/live-sessions?stale_after_seconds=60",
        headers=_auth_headers(admin, db),
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 1
    assert payload["active_count"] == 1
    assert payload["stale_count"] == 1
    assert payload["pending_pair_count"] == 0
    item = payload["items"][0]
    assert item["device_id"] == "monitor-live-001"
    assert item["device_display_name"] == "Lung Cart A"
    assert item["patient_id"] == str(patient.id)
    assert item["patient_name"] == "Device Monitor"
    assert item["measurement_type"] == "lung_sound"
    assert item["status"] == "active"
    assert item["freshness_status"] == "stale"
    assert item["seconds_since_last_seen"] >= 240


def test_live_device_sessions_for_doctor_only_returns_assigned_patients(
    client: TestClient,
    db: Session,
):
    doctor = _create_user(db, email="device-live-doctor@example.com", role=UserRole.doctor)
    other_doctor = _create_user(db, email="device-live-other@example.com", role=UserRole.doctor)
    assigned_patient = _create_patient(db)
    other_patient = Patient(
        first_name="Other",
        last_name="Patient",
        date_of_birth=date(1992, 3, 3),
    )
    db.add(other_patient)
    db.commit()
    db.refresh(other_patient)
    _assign_doctor(db, doctor=doctor, patient=assigned_patient)
    _assign_doctor(db, doctor=other_doctor, patient=other_patient)
    _register_device(db, device_id="monitor-live-002", display_name="Lung Cart B")
    _register_device(db, device_id="monitor-live-003", display_name="Lung Cart C")
    now = datetime.now(timezone.utc)
    db.add_all(
        [
            DeviceExamSession(
                patient_id=assigned_patient.id,
                device_id="monitor-live-002",
                measurement_type=DeviceExamMeasurementType.lung_sound,
                status=DeviceExamSessionStatus.active,
                pairing_code="LIVE02",
                started_at=now - timedelta(minutes=3),
                last_seen_at=now - timedelta(seconds=20),
            ),
            DeviceExamSession(
                patient_id=other_patient.id,
                device_id="monitor-live-003",
                measurement_type=DeviceExamMeasurementType.heart_sound,
                status=DeviceExamSessionStatus.active,
                pairing_code="LIVE03",
                started_at=now - timedelta(minutes=2),
                last_seen_at=now - timedelta(seconds=10),
            ),
        ]
    )
    db.commit()

    response = client.get(
        "/device/v1/live-sessions",
        headers=_auth_headers(doctor, db),
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 1
    item = payload["items"][0]
    assert item["patient_id"] == str(assigned_patient.id)
    assert item["device_id"] == "monitor-live-002"
    assert item["freshness_status"] == "fresh"


def test_device_inventory_returns_idle_in_use_and_inactive_for_admin(
    client: TestClient,
    db: Session,
):
    admin = _create_user(db, email="device-inventory-admin@example.com", role=UserRole.admin)
    patient = _create_patient(db)
    active_device = _register_device(db, device_id="inventory-001", display_name="Inventory Active")
    _register_device(db, device_id="inventory-002", display_name="Inventory Idle")
    inactive_device = DeviceRegistration(
        device_id="inventory-003",
        display_name="Inventory Inactive",
        default_measurement_type=DeviceExamMeasurementType.lung_sound,
        is_active=False,
    )
    inactive_device.device_secret = "inventory-secret"
    db.add(inactive_device)
    now = datetime.now(timezone.utc)
    db.add(
        DeviceExamSession(
            patient_id=patient.id,
            device_id=active_device.device_id,
            measurement_type=DeviceExamMeasurementType.lung_sound,
            status=DeviceExamSessionStatus.active,
            pairing_code="INV001",
            started_at=now - timedelta(minutes=1),
            last_seen_at=now - timedelta(seconds=15),
        )
    )
    db.commit()

    response = client.get(
        "/device/v1/device-inventory",
        headers=_auth_headers(admin, db),
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 3
    assert payload["in_use_count"] == 1
    assert payload["idle_count"] == 1
    assert payload["inactive_count"] == 1
    items = {item["device_id"]: item for item in payload["items"]}
    statuses = {item["device_id"]: item["availability_status"] for item in payload["items"]}
    assert statuses["inventory-001"] == "in_use"
    assert statuses["inventory-002"] == "idle"
    assert statuses["inventory-003"] == "inactive"
    assert items["inventory-001"]["default_measurement_type"] == "lung_sound"
    assert items["inventory-002"]["default_measurement_type"] == "lung_sound"
    assert items["inventory-003"]["default_measurement_type"] == "lung_sound"


def test_device_inventory_redacts_unassigned_busy_session_for_doctor(
    client: TestClient,
    db: Session,
):
    doctor = _create_user(db, email="device-inventory-doctor@example.com", role=UserRole.doctor)
    other_doctor = _create_user(db, email="device-inventory-other@example.com", role=UserRole.doctor)
    assigned_patient = _create_patient(db)
    other_patient = Patient(
        first_name="Busy",
        last_name="Elsewhere",
        date_of_birth=date(1994, 4, 4),
    )
    db.add(other_patient)
    db.commit()
    db.refresh(other_patient)
    _assign_doctor(db, doctor=doctor, patient=assigned_patient)
    _assign_doctor(db, doctor=other_doctor, patient=other_patient)
    _register_device(db, device_id="inventory-004", display_name="Inventory Shared Busy")
    _register_device(db, device_id="inventory-005", display_name="Inventory Shared In Use")
    now = datetime.now(timezone.utc)
    db.add_all(
        [
            DeviceExamSession(
                patient_id=other_patient.id,
                device_id="inventory-004",
                measurement_type=DeviceExamMeasurementType.lung_sound,
                status=DeviceExamSessionStatus.active,
                pairing_code="INV004",
                started_at=now - timedelta(minutes=2),
                last_seen_at=now - timedelta(seconds=25),
            ),
            DeviceExamSession(
                patient_id=assigned_patient.id,
                device_id="inventory-005",
                measurement_type=DeviceExamMeasurementType.heart_sound,
                status=DeviceExamSessionStatus.active,
                pairing_code="INV005",
                started_at=now - timedelta(minutes=1),
                last_seen_at=now - timedelta(seconds=10),
            ),
        ]
    )
    db.commit()

    response = client.get(
        "/device/v1/device-inventory",
        headers=_auth_headers(doctor, db),
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    items = {item["device_id"]: item for item in payload["items"]}
    assert items["inventory-004"]["availability_status"] == "busy"
    assert items["inventory-004"]["patient_id"] is None
    assert items["inventory-004"]["patient_name"] is None
    assert items["inventory-005"]["availability_status"] == "in_use"
    assert items["inventory-005"]["patient_id"] == str(assigned_patient.id)


def test_lung_sound_review_queue_returns_flagged_records_for_admin(
    client: TestClient,
    db: Session,
):
    admin = _create_user(db, email="device-review-admin@example.com", role=UserRole.admin)
    patient = _create_patient(db)
    _register_device(db, device_id="review-device-001", display_name="Review Device 001")
    now = datetime.now(timezone.utc)

    needs_review_session = DeviceExamSession(
        patient_id=patient.id,
        device_id="review-device-001",
        measurement_type=DeviceExamMeasurementType.lung_sound,
        status=DeviceExamSessionStatus.review_needed,
        pairing_code="RVW001",
        started_at=now - timedelta(minutes=10),
        ended_at=now - timedelta(minutes=5),
        last_seen_at=now - timedelta(minutes=5),
    )
    db.add(needs_review_session)
    db.flush()

    db.add_all(
        [
            LungSoundRecord(
                patient_id=patient.id,
                device_exam_session_id=needs_review_session.id,
                device_id="review-device-001",
                routing_status=DeviceMeasurementRoutingStatus.needs_review,
                position=1,
                recorded_at=now - timedelta(minutes=6),
                server_received_at=now - timedelta(minutes=6),
            ),
            LungSoundRecord(
                patient_id=None,
                device_exam_session_id=None,
                device_id="review-device-001",
                routing_status=DeviceMeasurementRoutingStatus.unmatched,
                position=2,
                recorded_at=now - timedelta(minutes=4),
                server_received_at=now - timedelta(minutes=4),
            ),
        ]
    )
    db.commit()

    response = client.get(
        "/device/v1/review/lung-sounds",
        headers=_auth_headers(admin, db),
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 2
    assert payload["needs_review_count"] == 1
    assert payload["unmatched_count"] == 1
    statuses = {item["routing_status"] for item in payload["items"]}
    assert statuses == {"needs_review", "unmatched"}


def test_lung_sound_review_resolve_verified_relinks_record_and_closes_review_session(
    client: TestClient,
    db: Session,
):
    admin = _create_user(db, email="device-review-resolve-admin@example.com", role=UserRole.admin)
    patient_old = _create_patient(db)
    patient_new = Patient(
        first_name="Resolved",
        last_name="Patient",
        date_of_birth=date(1989, 3, 3),
    )
    db.add(patient_new)
    db.commit()
    db.refresh(patient_new)
    _register_device(db, device_id="review-device-002", display_name="Review Device 002")
    now = datetime.now(timezone.utc)

    old_review_session = DeviceExamSession(
        patient_id=patient_old.id,
        device_id="review-device-002",
        measurement_type=DeviceExamMeasurementType.lung_sound,
        status=DeviceExamSessionStatus.review_needed,
        pairing_code="RVW002",
        started_at=now - timedelta(minutes=12),
        ended_at=now - timedelta(minutes=8),
        last_seen_at=now - timedelta(minutes=8),
    )
    target_session = DeviceExamSession(
        patient_id=patient_new.id,
        device_id="review-device-002",
        measurement_type=DeviceExamMeasurementType.lung_sound,
        status=DeviceExamSessionStatus.active,
        pairing_code="RVW003",
        started_at=now - timedelta(minutes=2),
        last_seen_at=now - timedelta(minutes=1),
    )
    db.add_all([old_review_session, target_session])
    db.flush()

    flagged_record = LungSoundRecord(
        patient_id=patient_old.id,
        device_exam_session_id=old_review_session.id,
        device_id="review-device-002",
        routing_status=DeviceMeasurementRoutingStatus.needs_review,
        position=3,
        recorded_at=now - timedelta(minutes=9),
        server_received_at=now - timedelta(minutes=9),
    )
    db.add(flagged_record)
    db.commit()
    db.refresh(flagged_record)

    response = client.post(
        f"/device/v1/review/lung-sounds/{flagged_record.id}",
        json={
            "resolution": "verified",
            "target_session_id": str(target_session.id),
            "note": "manual triage",
        },
        headers=_auth_headers(admin, db),
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["routing_status"] == "verified"
    assert payload["device_exam_session_id"] == str(target_session.id)
    assert payload["patient_id"] == str(patient_new.id)

    db.refresh(flagged_record)
    db.refresh(old_review_session)
    assert flagged_record.routing_status == DeviceMeasurementRoutingStatus.verified
    assert flagged_record.device_exam_session_id == target_session.id
    assert flagged_record.patient_id == patient_new.id
    assert old_review_session.status == DeviceExamSessionStatus.completed
