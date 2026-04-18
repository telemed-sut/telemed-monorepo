import hashlib
import hmac
import json
import os
import time
from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import pressure as pressure_api
from app.core.secret_crypto import SECRET_VALUE_PREFIX
from app.models.device_registration import DeviceRegistration
from app.models.device_request_nonce import DeviceRequestNonce
from app.models.patient import Patient


def _create_patient(db: Session) -> Patient:
    patient = Patient(
        first_name="Pressure",
        last_name="Test",
        date_of_birth=date(1990, 1, 1),
    )
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


def _sign_headers(
    *,
    device_id: str,
    timestamp: str,
    body_hash: str | None = None,
    nonce: str | None = None,
    secret: str | None = None,
):
    resolved_secret = secret or os.environ["DEVICE_API_SECRET"]
    message = f"{timestamp}{device_id}"
    if body_hash:
        message += body_hash
    if nonce:
        message += nonce
    signature = hmac.new(resolved_secret.encode(), message.encode(), hashlib.sha256).hexdigest()

    headers = {
        "X-Device-Id": device_id,
        "X-Timestamp": timestamp,
        "X-Signature": signature,
    }
    if body_hash:
        headers["X-Body-Hash"] = body_hash
    if nonce:
        headers["X-Nonce"] = nonce
    return headers


def test_add_pressure_accepts_legacy_signature(client: TestClient, db: Session):
    patient = _create_patient(db)
    payload = {
        "user_id": str(patient.id),
        "device_id": "device-legacy-001",
        "heart_rate": 78,
        "sys_rate": 122,
        "dia_rate": 81,
        "a": None,
        "b": None,
    }
    headers = _sign_headers(
        device_id="device-legacy-001",
        timestamp=str(int(time.time())),
    )

    response = client.post("/add_pressure", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    assert response.json() == {"status": "ok"}


def test_device_v1_pressure_success_response_is_minimal(client: TestClient, db: Session):
    patient = _create_patient(db)
    payload = {
        "user_id": str(patient.id),
        "device_id": "device-minimal-response-001",
        "heart_rate": 76,
        "sys_rate": 121,
        "dia_rate": 80,
        "a": None,
        "b": None,
    }
    headers = _sign_headers(
        device_id="device-minimal-response-001",
        timestamp=str(int(time.time())),
    )

    response = client.post("/device/v1/pressure", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    assert response.json() == {"status": "ok"}
    assert "id" not in response.json()
    assert "patient_id" not in response.json()
    assert "received_at" not in response.json()


def test_add_pressure_rejects_header_payload_device_id_mismatch(client: TestClient, db: Session):
    patient = _create_patient(db)
    payload = {
        "user_id": str(patient.id),
        "device_id": "payload-device-001",
        "heart_rate": 80,
        "sys_rate": 130,
        "dia_rate": 85,
        "a": None,
        "b": None,
    }
    headers = _sign_headers(
        device_id="header-device-001",
        timestamp=str(int(time.time())),
    )

    response = client.post("/add_pressure", json=payload, headers=headers)
    assert response.status_code == 403
    assert "Invalid signature" in response.text


def test_add_pressure_accepts_body_hash_signature(client: TestClient, db: Session):
    patient = _create_patient(db)
    payload = {
        "user_id": str(patient.id),
        "device_id": "device-hash-001",
        "heart_rate": 77,
        "sys_rate": 120,
        "dia_rate": 79,
        "a": None,
        "b": None,
    }
    payload_raw = json.dumps(payload, separators=(",", ":"))
    body_hash = hashlib.sha256(payload_raw.encode("utf-8")).hexdigest()
    headers = _sign_headers(
        device_id="device-hash-001",
        timestamp=str(int(time.time())),
        body_hash=body_hash,
    )
    headers["Content-Type"] = "application/json"

    response = client.post("/add_pressure", content=payload_raw, headers=headers)
    assert response.status_code == 201, response.text


def test_add_pressure_rejects_invalid_body_hash(client: TestClient, db: Session):
    patient = _create_patient(db)
    payload = {
        "user_id": str(patient.id),
        "device_id": "device-hash-invalid-001",
        "heart_rate": 77,
        "sys_rate": 120,
        "dia_rate": 79,
        "a": None,
        "b": None,
    }
    payload_raw = json.dumps(payload, separators=(",", ":"))
    wrong_hash = hashlib.sha256(b"tampered").hexdigest()
    headers = _sign_headers(
        device_id="device-hash-invalid-001",
        timestamp=str(int(time.time())),
        body_hash=wrong_hash,
    )
    headers["Content-Type"] = "application/json"

    response = client.post("/add_pressure", content=payload_raw, headers=headers)
    assert response.status_code == 403
    assert "Invalid signature" in response.text


def test_add_pressure_requires_body_hash_when_strict_enabled(client: TestClient, db: Session):
    patient = _create_patient(db)
    payload = {
        "user_id": str(patient.id),
        "device_id": "device-strict-001",
        "heart_rate": 82,
        "sys_rate": 128,
        "dia_rate": 84,
        "a": None,
        "b": None,
    }
    headers = _sign_headers(
        device_id="device-strict-001",
        timestamp=str(int(time.time())),
    )

    original = pressure_api.settings.device_api_require_body_hash_signature
    pressure_api.settings.device_api_require_body_hash_signature = True
    try:
        response = client.post("/add_pressure", json=payload, headers=headers)
        assert response.status_code == 403
        assert "Invalid signature" in response.text
    finally:
        pressure_api.settings.device_api_require_body_hash_signature = original


def test_pressure_schema_rejects_sys_not_greater_than_dia(client: TestClient, db: Session):
    patient = _create_patient(db)
    payload = {
        "user_id": str(patient.id),
        "device_id": "device-validation-001",
        "heart_rate": 90,
        "sys_rate": 80,
        "dia_rate": 85,
        "a": None,
        "b": None,
    }
    headers = _sign_headers(
        device_id="device-validation-001",
        timestamp=str(int(time.time())),
    )

    response = client.post("/add_pressure", json=payload, headers=headers)
    assert response.status_code == 422


def test_add_pressure_requires_nonce_when_strict_enabled(client: TestClient, db: Session):
    patient = _create_patient(db)
    payload = {
        "user_id": str(patient.id),
        "device_id": "device-nonce-required-001",
        "heart_rate": 81,
        "sys_rate": 124,
        "dia_rate": 82,
        "a": None,
        "b": None,
    }
    headers = _sign_headers(
        device_id="device-nonce-required-001",
        timestamp=str(int(time.time())),
    )

    original_require_nonce = pressure_api.settings.device_api_require_nonce
    pressure_api.settings.device_api_require_nonce = True
    try:
        response = client.post("/add_pressure", json=payload, headers=headers)
        assert response.status_code == 403
        assert "Invalid signature" in response.text
    finally:
        pressure_api.settings.device_api_require_nonce = original_require_nonce


def test_add_pressure_accepts_nonce_and_rejects_replay(client: TestClient, db: Session):
    patient = _create_patient(db)
    payload = {
        "user_id": str(patient.id),
        "device_id": "device-nonce-replay-001",
        "heart_rate": 81,
        "sys_rate": 124,
        "dia_rate": 82,
        "a": None,
        "b": None,
    }
    nonce = f"nonce-{int(time.time() * 1000)}"
    headers = _sign_headers(
        device_id="device-nonce-replay-001",
        timestamp=str(int(time.time())),
        nonce=nonce,
    )

    original_require_nonce = pressure_api.settings.device_api_require_nonce
    pressure_api.settings.device_api_require_nonce = True
    try:
        first_response = client.post("/add_pressure", json=payload, headers=headers)
        assert first_response.status_code == 201, first_response.text

        replay_response = client.post("/add_pressure", json=payload, headers=headers)
        assert replay_response.status_code == 403
        assert "Invalid signature" in replay_response.text
    finally:
        pressure_api.settings.device_api_require_nonce = original_require_nonce


def test_add_pressure_uses_redis_for_nonce_replay_protection(client: TestClient, db: Session, monkeypatch):
    patient = _create_patient(db)
    payload = {
        "user_id": str(patient.id),
        "device_id": "device-redis-nonce-001",
        "heart_rate": 81,
        "sys_rate": 124,
        "dia_rate": 82,
        "a": None,
        "b": None,
    }
    nonce = f"nonce-redis-{int(time.time() * 1000)}"
    headers = _sign_headers(
        device_id="device-redis-nonce-001",
        timestamp=str(int(time.time())),
        nonce=nonce,
    )

    class FakeRedisClient:
        def __init__(self):
            self.keys = set()
            self.calls = []

        def set(self, key, value, ex=None, nx=False):
            self.calls.append({"key": key, "value": value, "ex": ex, "nx": nx})
            if nx and key in self.keys:
                return False
            self.keys.add(key)
            return True

    fake_redis = FakeRedisClient()
    monkeypatch.setattr(pressure_api, "get_redis_client_or_log", lambda *args, **kwargs: fake_redis)

    original_require_nonce = pressure_api.settings.device_api_require_nonce
    pressure_api.settings.device_api_require_nonce = True
    try:
        first_response = client.post("/add_pressure", json=payload, headers=headers)
        assert first_response.status_code == 201, first_response.text

        replay_response = client.post("/add_pressure", json=payload, headers=headers)
        assert replay_response.status_code == 403
        assert "Invalid signature" in replay_response.text

        stored_nonces = db.scalars(select(DeviceRequestNonce)).all()
        assert stored_nonces == []
        assert len(fake_redis.calls) == 2
        assert fake_redis.calls[0]["nx"] is True
    finally:
        pressure_api.settings.device_api_require_nonce = original_require_nonce


def test_add_pressure_falls_back_to_db_nonce_storage_when_redis_unavailable(client: TestClient, db: Session, monkeypatch):
    patient = _create_patient(db)
    payload = {
        "user_id": str(patient.id),
        "device_id": "device-db-fallback-nonce-001",
        "heart_rate": 81,
        "sys_rate": 124,
        "dia_rate": 82,
        "a": None,
        "b": None,
    }
    nonce = f"nonce-db-fallback-{int(time.time() * 1000)}"
    headers = _sign_headers(
        device_id="device-db-fallback-nonce-001",
        timestamp=str(int(time.time())),
        nonce=nonce,
    )

    class BrokenRedisClient:
        def set(self, *args, **kwargs):
            raise RuntimeError("redis unavailable")

    monkeypatch.setattr(pressure_api, "get_redis_client_or_log", lambda *args, **kwargs: BrokenRedisClient())

    original_require_nonce = pressure_api.settings.device_api_require_nonce
    pressure_api.settings.device_api_require_nonce = True
    try:
        first_response = client.post("/add_pressure", json=payload, headers=headers)
        assert first_response.status_code == 201, first_response.text

        replay_response = client.post("/add_pressure", json=payload, headers=headers)
        assert replay_response.status_code == 403
        assert "Invalid signature" in replay_response.text

        stored_nonces = db.scalars(select(DeviceRequestNonce)).all()
        assert len(stored_nonces) == 1
        assert stored_nonces[0].device_id == "device-db-fallback-nonce-001"
    finally:
        pressure_api.settings.device_api_require_nonce = original_require_nonce


def test_add_pressure_accepts_per_device_secret_map(client: TestClient, db: Session):
    patient = _create_patient(db)
    payload = {
        "user_id": str(patient.id),
        "device_id": "device-map-001",
        "heart_rate": 79,
        "sys_rate": 121,
        "dia_rate": 80,
        "a": None,
        "b": None,
    }
    device_secret = "device_secret_map_001_1234567890abcdef1234567890abcd"
    headers = _sign_headers(
        device_id="device-map-001",
        timestamp=str(int(time.time())),
        secret=device_secret,
    )

    original_secret_map = dict(pressure_api.settings.device_api_secrets)
    original_require_registered = pressure_api.settings.device_api_require_registered_device
    original_global_secret = pressure_api.settings.device_api_secret

    pressure_api.settings.device_api_secrets = {"device-map-001": device_secret}
    pressure_api.settings.device_api_require_registered_device = True
    pressure_api.settings.device_api_secret = None
    try:
        response = client.post("/add_pressure", json=payload, headers=headers)
        assert response.status_code == 201, response.text

        unknown_headers = _sign_headers(
            device_id="unknown-device-001",
            timestamp=str(int(time.time())),
            secret=device_secret,
        )
        unknown_payload = {**payload, "device_id": "unknown-device-001"}
        unknown_response = client.post("/add_pressure", json=unknown_payload, headers=unknown_headers)
        assert unknown_response.status_code == 403
        assert "Invalid signature" in unknown_response.text
    finally:
        pressure_api.settings.device_api_secrets = original_secret_map
        pressure_api.settings.device_api_require_registered_device = original_require_registered
        pressure_api.settings.device_api_secret = original_global_secret


def test_add_pressure_accepts_strict_mode_with_registered_device(client: TestClient, db: Session):
    patient = _create_patient(db)
    device_id = "strict-device-001"
    device_secret = "strict_device_secret_001_1234567890abcdef1234567890abc"
    payload = {
        "user_id": str(patient.id),
        "device_id": device_id,
        "heart_rate": 83,
        "sys_rate": 126,
        "dia_rate": 84,
        "a": None,
        "b": None,
    }
    payload_raw = json.dumps(payload, separators=(",", ":"))
    body_hash = hashlib.sha256(payload_raw.encode("utf-8")).hexdigest()
    nonce = f"strict-{int(time.time() * 1000)}"
    headers = _sign_headers(
        device_id=device_id,
        timestamp=str(int(time.time())),
        body_hash=body_hash,
        nonce=nonce,
        secret=device_secret,
    )
    headers["Content-Type"] = "application/json"

    original_secret_map = dict(pressure_api.settings.device_api_secrets)
    original_require_registered = pressure_api.settings.device_api_require_registered_device
    original_require_body_hash = pressure_api.settings.device_api_require_body_hash_signature
    original_require_nonce = pressure_api.settings.device_api_require_nonce
    original_global_secret = pressure_api.settings.device_api_secret

    pressure_api.settings.device_api_secrets = {device_id: device_secret}
    pressure_api.settings.device_api_require_registered_device = True
    pressure_api.settings.device_api_require_body_hash_signature = True
    pressure_api.settings.device_api_require_nonce = True
    pressure_api.settings.device_api_secret = None
    try:
        response = client.post("/add_pressure", content=payload_raw, headers=headers)
        assert response.status_code == 201, response.text
    finally:
        pressure_api.settings.device_api_secrets = original_secret_map
        pressure_api.settings.device_api_require_registered_device = original_require_registered
        pressure_api.settings.device_api_require_body_hash_signature = original_require_body_hash
        pressure_api.settings.device_api_require_nonce = original_require_nonce
        pressure_api.settings.device_api_secret = original_global_secret


def test_add_pressure_accepts_db_registered_device_and_updates_last_seen(client: TestClient, db: Session):
    patient = _create_patient(db)
    device_id = "db-registered-001"
    device_secret = "db_registered_secret_001_1234567890abcdef123456789"
    device = DeviceRegistration(
        device_id=device_id,
        display_name="Ward Device 01",
        device_secret=device_secret,
        is_active=True,
    )
    db.add(device)
    db.commit()
    db.refresh(device)

    payload = {
        "user_id": str(patient.id),
        "device_id": device_id,
        "heart_rate": 80,
        "sys_rate": 124,
        "dia_rate": 81,
        "a": None,
        "b": None,
    }
    headers = _sign_headers(
        device_id=device_id,
        timestamp=str(int(time.time())),
        secret=device_secret,
    )

    original_secret_map = dict(pressure_api.settings.device_api_secrets)
    original_require_registered = pressure_api.settings.device_api_require_registered_device
    original_global_secret = pressure_api.settings.device_api_secret

    pressure_api.settings.device_api_secrets = {}
    pressure_api.settings.device_api_require_registered_device = True
    pressure_api.settings.device_api_secret = None
    try:
        response = client.post("/add_pressure", json=payload, headers=headers)
        assert response.status_code == 201, response.text
        db.refresh(device)
        assert device.last_seen_at is not None
    finally:
        pressure_api.settings.device_api_secrets = original_secret_map
        pressure_api.settings.device_api_require_registered_device = original_require_registered
        pressure_api.settings.device_api_secret = original_global_secret


def test_add_pressure_rejects_inactive_registered_device(client: TestClient, db: Session):
    patient = _create_patient(db)
    device_id = "db-inactive-001"
    device_secret = "db_inactive_secret_001_1234567890abcdef1234567890"
    device = DeviceRegistration(
        device_id=device_id,
        display_name="Ward Device Inactive",
        device_secret=device_secret,
        is_active=False,
    )
    db.add(device)
    db.commit()

    payload = {
        "user_id": str(patient.id),
        "device_id": device_id,
        "heart_rate": 80,
        "sys_rate": 124,
        "dia_rate": 81,
        "a": None,
        "b": None,
    }
    headers = _sign_headers(
        device_id=device_id,
        timestamp=str(int(time.time())),
        secret=device_secret,
    )

    original_secret_map = dict(pressure_api.settings.device_api_secrets)
    original_require_registered = pressure_api.settings.device_api_require_registered_device
    original_global_secret = pressure_api.settings.device_api_secret

    pressure_api.settings.device_api_secrets = {}
    pressure_api.settings.device_api_require_registered_device = True
    pressure_api.settings.device_api_secret = None
    try:
        response = client.post("/add_pressure", json=payload, headers=headers)
        assert response.status_code == 403
        assert "Invalid signature" in response.text
    finally:
        pressure_api.settings.device_api_secrets = original_secret_map
        pressure_api.settings.device_api_require_registered_device = original_require_registered
        pressure_api.settings.device_api_secret = original_global_secret


def test_add_pressure_rejects_malformed_encrypted_registered_device_secret(client: TestClient, db: Session):
    patient = _create_patient(db)
    device_id = "db-malformed-secret-001"
    device_secret = "db_malformed_secret_001_1234567890abcdef123456789"
    device = DeviceRegistration(
        device_id=device_id,
        display_name="Ward Device Malformed Secret",
        device_secret=device_secret,
        is_active=True,
    )
    db.add(device)
    db.commit()
    device._device_secret_encrypted = f"{SECRET_VALUE_PREFIX}not-valid"
    db.add(device)
    db.commit()

    payload = {
        "user_id": str(patient.id),
        "device_id": device_id,
        "heart_rate": 80,
        "sys_rate": 124,
        "dia_rate": 81,
        "a": None,
        "b": None,
    }
    headers = _sign_headers(
        device_id=device_id,
        timestamp=str(int(time.time())),
        secret=device_secret,
    )

    original_secret_map = dict(pressure_api.settings.device_api_secrets)
    original_require_registered = pressure_api.settings.device_api_require_registered_device
    original_global_secret = pressure_api.settings.device_api_secret

    pressure_api.settings.device_api_secrets = {}
    pressure_api.settings.device_api_require_registered_device = True
    pressure_api.settings.device_api_secret = None
    try:
        response = client.post("/add_pressure", json=payload, headers=headers)
        assert response.status_code == 403
        assert "Invalid signature" in response.text
    finally:
        pressure_api.settings.device_api_secrets = original_secret_map
        pressure_api.settings.device_api_require_registered_device = original_require_registered
        pressure_api.settings.device_api_secret = original_global_secret
