import hashlib
import hmac
import json
import time
from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models.enums import UserRole
from app.models.patient import Patient
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
        first_name="Heart",
        last_name="Sound",
        date_of_birth=date(1994, 6, 15),
    )
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


def _sign_request(*, device_secret: str, device_id: str, timestamp: str) -> str:
    message = f"{timestamp}{device_id}"
    return hmac.new(device_secret.encode(), message.encode(), hashlib.sha256).hexdigest()


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_create_and_list_patient_heart_sounds(
    client: TestClient,
    db: Session,
):
    admin_email = "heart-sound-admin@example.com"
    admin_password = "TestPass123"
    device_id = "heart-sound-device-001"
    device_secret = "test_device_secret_1234567890abcdef1234567890abcdef"

    _create_admin(db, admin_email, admin_password)
    patient = _create_patient(db)

    login_response = client.post(
        "/auth/login",
        json={"email": admin_email, "password": admin_password},
    )
    assert login_response.status_code == 200, login_response.text
    access_token = login_response.json()["access_token"]

    payload = {
        "user_id": str(patient.id),
        "mac_address": "F6:62:73:62:79:5E",
        "position": 3,
        "blob_url": "https://example.blob.core.windows.net/heart-sounds/patient-1.wav",
        "storage_key": "heart-sounds/patient-1.wav",
        "mime_type": "audio/wav",
        "duration_seconds": 12,
        "recorded_at": "2026-03-27T04:50:00Z",
    }
    payload_raw = json.dumps(payload, separators=(",", ":"))
    timestamp = str(int(time.time()))
    signature = _sign_request(
        device_secret=device_secret,
        device_id=device_id,
        timestamp=timestamp,
    )
    ingest_headers = {
        "Content-Type": "application/json",
        "X-Device-Id": device_id,
        "X-Timestamp": timestamp,
        "X-Signature": signature,
    }

    ingest_response = client.post(
        "/device/v1/heart-sounds",
        content=payload_raw,
        headers=ingest_headers,
    )
    assert ingest_response.status_code == 201, ingest_response.text
    ingest_payload = ingest_response.json()
    assert ingest_payload["status"] == "ok"
    assert ingest_payload["record_id"]

    list_response = client.get(
        f"/patients/{patient.id}/heart-sounds",
        headers=_auth_headers(access_token),
    )
    assert list_response.status_code == 200, list_response.text
    body = list_response.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["patient_id"] == str(patient.id)
    assert body["items"][0]["device_id"] == device_id
    assert body["items"][0]["mac_address"] == "F6:62:73:62:79:5E"
    assert body["items"][0]["position"] == 3
    assert body["items"][0]["blob_url"] == "https://example.blob.core.windows.net/heart-sounds/patient-1.wav"
