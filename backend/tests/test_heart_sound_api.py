import hashlib
import hmac
import json
import os
import time
from datetime import date, datetime
from io import BytesIO

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models.heart_sound_record import HeartSoundRecord
from app.models.enums import UserRole
from app.models.patient import Patient
from app.models.user import User
from app.services.blob_storage import PreparedBlobUpload, UploadedBlob


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
    monkeypatch,
):
    admin_email = "heart-sound-admin@example.com"
    admin_password = "TestPass123"
    device_id = "heart-sound-device-001"
    device_secret = os.environ["DEVICE_API_SECRET"]

    _create_admin(db, admin_email, admin_password)
    patient = _create_patient(db)
    monkeypatch.setattr(
        "app.services.heart_sound.azure_blob_storage_service.build_read_url",
        lambda storage_key, fallback_url: fallback_url,
    )

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


def test_upload_patient_heart_sound_via_dashboard(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    admin_email = "heart-sound-upload-admin@example.com"
    admin_password = "TestPass123"

    _create_admin(db, admin_email, admin_password)
    patient = _create_patient(db)

    login_response = client.post(
        "/auth/login",
        json={"email": admin_email, "password": admin_password},
    )
    assert login_response.status_code == 200, login_response.text
    access_token = login_response.json()["access_token"]

    monkeypatch.setattr(
        "app.api.heart_sound.azure_blob_storage_service.upload_heart_sound",
        lambda **_: UploadedBlob(
            blob_url="https://example.blob.core.windows.net/heart-sounds/patient-upload.wav",
            storage_key="heart-sounds/patient-upload.wav",
        ),
    )
    monkeypatch.setattr(
        "app.services.heart_sound.azure_blob_storage_service.build_read_url",
        lambda storage_key, fallback_url: (
            f"{fallback_url}?sig=test"
            if storage_key == "heart-sounds/patient-upload.wav"
            else fallback_url
        ),
    )

    response = client.post(
        f"/patients/{patient.id}/heart-sounds/upload",
        headers=_auth_headers(access_token),
        files={"file": ("patient-upload.wav", BytesIO(b"RIFF...."), "audio/wav")},
        data={
            "position": "4",
            "recorded_at": "2026-04-19T14:30:00Z",
        },
    )
    assert response.status_code == 201, response.text

    body = response.json()
    assert body["patient_id"] == str(patient.id)
    assert body["position"] == 4
    assert body["storage_key"] == "heart-sounds/patient-upload.wav"
    assert body["blob_url"].endswith("?sig=test")
    assert body["device_id"].startswith("doctor-upload:")
    assert body["mac_address"] == "MANUAL_UPLOAD"

    list_response = client.get(
        f"/patients/{patient.id}/heart-sounds",
        headers=_auth_headers(access_token),
    )
    assert list_response.status_code == 200, list_response.text
    listed = list_response.json()
    assert listed["items"][0]["storage_key"] == "heart-sounds/patient-upload.wav"
    assert listed["items"][0]["blob_url"].endswith("?sig=test")


def test_create_and_complete_patient_heart_sound_direct_upload(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    admin_email = "heart-sound-direct-upload-admin@example.com"
    admin_password = "TestPass123"

    _create_admin(db, admin_email, admin_password)
    patient = _create_patient(db)

    login_response = client.post(
        "/auth/login",
        json={"email": admin_email, "password": admin_password},
    )
    assert login_response.status_code == 200, login_response.text
    access_token = login_response.json()["access_token"]

    monkeypatch.setattr(
        "app.api.heart_sound.azure_blob_storage_service.prepare_heart_sound_upload",
        lambda **_: PreparedBlobUpload(
            blob_url="https://example.blob.core.windows.net/heart-sounds/patient-direct.wav",
            storage_key="patient-direct.wav",
            upload_url="https://example.blob.core.windows.net/heart-sounds/patient-direct.wav?sig=upload",
            expires_at=datetime.fromisoformat("2026-04-20T03:00:00+00:00"),
        ),
    )
    monkeypatch.setattr(
        "app.api.heart_sound.azure_blob_storage_service.blob_exists",
        lambda storage_key: storage_key == "patient-direct.wav",
    )
    monkeypatch.setattr(
        "app.services.heart_sound.azure_blob_storage_service.build_read_url",
        lambda storage_key, fallback_url: (
            f"{fallback_url}?sig=read"
            if storage_key == "patient-direct.wav"
            else fallback_url
        ),
    )

    session_response = client.post(
        f"/patients/{patient.id}/heart-sounds/upload-session",
        headers=_auth_headers(access_token),
        json={
            "filename": "patient-direct.wav",
            "position": 5,
            "file_size_bytes": 1024 * 1024,
            "mime_type": "audio/wav",
            "recorded_at": "2026-04-19T14:30:00Z",
        },
    )
    assert session_response.status_code == 201, session_response.text
    session_body = session_response.json()
    assert session_body["storage_key"] == "patient-direct.wav"
    assert session_body["upload_url"].endswith("?sig=upload")
    assert session_body["upload_headers"]["x-ms-blob-type"] == "BlockBlob"

    complete_response = client.post(
        f"/patients/{patient.id}/heart-sounds/complete-upload",
        headers=_auth_headers(access_token),
        json={
            "session_id": session_body["session_id"],
        },
    )
    assert complete_response.status_code == 201, complete_response.text

    body = complete_response.json()
    assert body["patient_id"] == str(patient.id)
    assert body["position"] == 5
    assert body["storage_key"] == "patient-direct.wav"
    assert body["blob_url"].endswith("?sig=read")
    assert body["device_id"].startswith("doctor-upload:")
    assert body["mac_address"] == "MANUAL_UPLOAD"


def test_admin_can_audit_heart_sound_storage_consistency(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    admin_email = "heart-sound-audit-admin@example.com"
    admin_password = "TestPass123"

    _create_admin(db, admin_email, admin_password)
    patient = _create_patient(db)

    record_ok = HeartSoundRecord(
        patient_id=patient.id,
        device_id="device-ok",
        mac_address="AA:BB:CC:DD:EE:01",
        position=1,
        blob_url="https://example.blob.core.windows.net/heart-sounds/patient-ok.wav",
        storage_key="patient-ok.wav",
        mime_type="audio/wav",
        recorded_at=date(2026, 4, 19),
    )
    record_legacy = HeartSoundRecord(
        patient_id=patient.id,
        device_id="device-legacy",
        mac_address="AA:BB:CC:DD:EE:02",
        position=2,
        blob_url="https://example.blob.core.windows.net/heart-sounds/heart-sounds/patient-legacy.wav",
        storage_key="heart-sounds/patient-legacy.wav",
        mime_type="audio/wav",
        recorded_at=date(2026, 4, 19),
    )
    db.add_all([record_ok, record_legacy])
    db.commit()

    login_response = client.post(
        "/auth/login",
        json={"email": admin_email, "password": admin_password},
    )
    assert login_response.status_code == 200, login_response.text
    access_token = login_response.json()["access_token"]

    monkeypatch.setattr(
        "app.services.heart_sound_storage_audit.azure_blob_storage_service.assert_ready",
        lambda: None,
    )
    monkeypatch.setattr(
        "app.services.heart_sound_storage_audit.azure_blob_storage_service.build_blob_url",
        lambda storage_key: f"https://example.blob.core.windows.net/heart-sounds/{storage_key}",
    )
    monkeypatch.setattr(
        "app.services.heart_sound_storage_audit.azure_blob_storage_service.blob_exists",
        lambda storage_key: True,
    )
    monkeypatch.setattr(
        "app.services.heart_sound_storage_audit.azure_blob_storage_service.normalize_legacy_storage_key",
        lambda storage_key: storage_key.removeprefix("heart-sounds/") if storage_key else None,
    )

    response = client.get(
        "/heart-sounds/storage-consistency-audit",
        headers=_auth_headers(access_token),
        params={"mismatches_only": "true", "limit": 10},
    )
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["total_records"] == 2
    assert body["scanned_count"] == 2
    assert body["inconsistent_count"] == 1
    assert body["issue_counts"] == {"legacy_storage_key_prefix": 1}
    assert len(body["items"]) == 1
    assert body["items"][0]["storage_key"] == "heart-sounds/patient-legacy.wav"
    assert body["items"][0]["normalized_storage_key"] == "patient-legacy.wav"
    assert body["items"][0]["issues"] == ["legacy_storage_key_prefix"]
