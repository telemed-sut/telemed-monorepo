import hashlib
import hmac
import os
import time
from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from sqlalchemy.orm import sessionmaker

from app import main as app_main
from app.api.device_monitor import _extract_error_code, _hint_for_error_code
from app.models.device_error_log import DeviceErrorLog
from app.models.patient import Patient


def _create_patient(db: Session) -> Patient:
    patient = Patient(
        first_name="Diag",
        last_name="Test",
        date_of_birth=date(1990, 1, 1),
    )
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


def _sign_headers(device_id: str, timestamp: str) -> dict[str, str]:
    secret = os.environ["DEVICE_API_SECRET"]
    message = f"{timestamp}{device_id}"
    signature = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    return {
        "X-Device-Id": device_id,
        "X-Timestamp": timestamp,
        "X-Signature": signature,
    }


def test_extract_error_code_and_hint():
    assert _extract_error_code("AUTH_FAILED:invalid_body_hash") == "invalid_body_hash"
    assert _extract_error_code("HTTP 404: Patient not found") == "http_404"
    assert _extract_error_code("VALIDATION_FAILED:heart_rate: Input should be <= 300") == "validation_failed"
    assert _extract_error_code("Invalid signature") == "invalid_signature"

    hint = _hint_for_error_code("invalid_body_hash")
    assert "X-Body-Hash" in hint


def test_validation_errors_are_logged_for_device_ingest(
    client: TestClient, db: Session, monkeypatch
):
    test_session_local = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=db.get_bind(),
        future=True,
    )
    monkeypatch.setattr(app_main, "SessionLocal", test_session_local)

    patient = _create_patient(db)
    payload = {
        "user_id": str(patient.id),
        "device_id": "diag-device-001",
        "heart_rate": 80,
        "sys_rate": 70,
        "dia_rate": 90,
        "a": [1, 2, 3],
        "b": [1, 2, 3],
    }
    headers = _sign_headers(device_id="diag-device-001", timestamp=str(int(time.time())))

    response = client.post("/add_pressure", json=payload, headers=headers)
    assert response.status_code == 422

    latest = (
        db.query(DeviceErrorLog)
        .filter(DeviceErrorLog.device_id == "diag-device-001")
        .order_by(DeviceErrorLog.id.desc())
        .first()
    )
    assert latest is not None
    assert latest.error_message.startswith("VALIDATION_FAILED:")
    assert "sys_rate" in latest.error_message
