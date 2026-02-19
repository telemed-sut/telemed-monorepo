import hashlib
import hmac
import json
import os
import time
from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api import pressure as pressure_api
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
):
    secret = os.environ["DEVICE_API_SECRET"]
    message = f"{timestamp}{device_id}"
    if body_hash:
        message += body_hash
    signature = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()

    headers = {
        "X-Device-Id": device_id,
        "X-Timestamp": timestamp,
        "X-Signature": signature,
    }
    if body_hash:
        headers["X-Body-Hash"] = body_hash
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
    assert "Device ID mismatch" in response.text


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

    response = client.post("/add_pressure", data=payload_raw, headers=headers)
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

    response = client.post("/add_pressure", data=payload_raw, headers=headers)
    assert response.status_code == 403
    assert "Invalid body hash" in response.text


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
        assert "Missing X-Body-Hash header" in response.text
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

