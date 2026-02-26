import hashlib
import hmac
import json
import time
from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import pressure as pressure_api
from app.core.security import get_password_hash
from app.models.enums import UserRole
from app.models.patient import Patient
from app.models.pressure_record import PressureRecord
from app.models.user import User


def _create_admin(db: Session, email: str, password: str) -> User:
    admin = User(
        email=email,
        password_hash=get_password_hash(password),
        role=UserRole.admin,
        is_active=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


def _create_patient(db: Session) -> Patient:
    patient = Patient(
        first_name="Device",
        last_name="Flow",
        date_of_birth=date(1991, 2, 2),
    )
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


def _sign_request(
    *,
    device_secret: str,
    device_id: str,
    timestamp: str,
    body_hash: str,
    nonce: str,
) -> str:
    message = f"{timestamp}{device_id}{body_hash}{nonce}"
    return hmac.new(device_secret.encode(), message.encode(), hashlib.sha256).hexdigest()


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_device_hmac_flow_from_admin_registration_to_ingest(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    admin_email = "device-e2e-admin@example.com"
    admin_password = "TestPass123"
    device_id = "ward-bp-e2e-001"

    _create_admin(db, admin_email, admin_password)
    patient = _create_patient(db)

    login_response = client.post(
        "/auth/login",
        json={"email": admin_email, "password": admin_password},
    )
    assert login_response.status_code == 200, login_response.text
    access_token = login_response.json()["access_token"]

    register_response = client.post(
        "/security/devices",
        json={
            "device_id": device_id,
            "display_name": "Ward BP E2E Device",
            "notes": "integration flow test",
            "is_active": True,
        },
        headers=_auth_headers(access_token),
    )
    assert register_response.status_code == 201, register_response.text
    register_payload = register_response.json()
    original_secret = register_payload["device_secret"]
    assert register_payload["device"]["device_id"] == device_id

    rotate_response = client.post(
        f"/security/devices/{device_id}/rotate-secret",
        json={},
        headers=_auth_headers(access_token),
    )
    assert rotate_response.status_code == 200, rotate_response.text
    rotate_payload = rotate_response.json()
    rotated_secret = rotate_payload["device_secret"]
    assert rotated_secret != original_secret

    payload = {
        "user_id": str(patient.id),
        "device_id": device_id,
        "heart_rate": 84,
        "sys_rate": 128,
        "dia_rate": 82,
        "a": None,
        "b": None,
    }
    payload_raw = json.dumps(payload, separators=(",", ":"))
    body_hash = hashlib.sha256(payload_raw.encode("utf-8")).hexdigest()

    monkeypatch.setattr(pressure_api.settings, "device_api_require_registered_device", True)
    monkeypatch.setattr(pressure_api.settings, "device_api_require_body_hash_signature", True)
    monkeypatch.setattr(pressure_api.settings, "device_api_require_nonce", True)

    timestamp = str(int(time.time()))
    nonce = f"e2e-nonce-{int(time.time() * 1000)}"
    signature = _sign_request(
        device_secret=rotated_secret,
        device_id=device_id,
        timestamp=timestamp,
        body_hash=body_hash,
        nonce=nonce,
    )
    ingest_headers = {
        "Content-Type": "application/json",
        "X-Device-Id": device_id,
        "X-Timestamp": timestamp,
        "X-Signature": signature,
        "X-Body-Hash": body_hash,
        "X-Nonce": nonce,
    }

    ingest_response = client.post(
        "/device/v1/pressure",
        content=payload_raw,
        headers=ingest_headers,
    )
    assert ingest_response.status_code == 201, ingest_response.text
    assert ingest_response.json() == {"status": "ok"}

    record = db.scalar(
        select(PressureRecord)
        .where(PressureRecord.device_id == device_id)
        .order_by(PressureRecord.created_at.desc())
    )
    assert record is not None
    assert str(record.patient_id) == str(patient.id)

    old_secret_nonce = f"e2e-old-secret-{int(time.time() * 1000)}"
    old_secret_signature = _sign_request(
        device_secret=original_secret,
        device_id=device_id,
        timestamp=str(int(time.time())),
        body_hash=body_hash,
        nonce=old_secret_nonce,
    )
    old_secret_headers = {
        "Content-Type": "application/json",
        "X-Device-Id": device_id,
        "X-Timestamp": str(int(time.time())),
        "X-Signature": old_secret_signature,
        "X-Body-Hash": body_hash,
        "X-Nonce": old_secret_nonce,
    }
    old_secret_response = client.post(
        "/device/v1/pressure",
        content=payload_raw,
        headers=old_secret_headers,
    )
    assert old_secret_response.status_code == 403
    assert old_secret_response.json()["detail"] == "Invalid signature"
