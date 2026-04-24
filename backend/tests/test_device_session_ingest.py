import hashlib
import hmac
import json
import os
import time
from datetime import date, datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.device_exam_session import DeviceExamSession
from app.models.device_registration import DeviceRegistration
from app.models.enums import (
    DeviceExamMeasurementType,
    DeviceExamSessionStatus,
    DeviceMeasurementRoutingStatus,
)
from app.models.heart_sound_record import HeartSoundRecord
from app.models.lung_sound_record import LungSoundRecord
from app.models.patient import Patient
from app.models.pressure_record import PressureRecord


def _create_patient(db: Session, *, first_name: str, last_name: str) -> Patient:
    patient = Patient(
        first_name=first_name,
        last_name=last_name,
        date_of_birth=date(1990, 1, 1),
    )
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


def _register_device(db: Session, *, device_id: str) -> DeviceRegistration:
    device = DeviceRegistration(
        device_id=device_id,
        display_name=device_id,
        is_active=True,
    )
    device.device_secret = os.environ["DEVICE_API_SECRET"]
    db.add(device)
    db.commit()
    db.refresh(device)
    return device


def _create_active_session(
    db: Session,
    *,
    patient: Patient,
    device_id: str,
    measurement_type: DeviceExamMeasurementType,
) -> DeviceExamSession:
    session = DeviceExamSession(
        patient_id=patient.id,
        device_id=device_id,
        measurement_type=measurement_type,
        status=DeviceExamSessionStatus.active,
        pairing_code="ABC123",
        started_at=datetime.now(timezone.utc),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def _sign_request(*, device_secret: str, device_id: str, timestamp: str) -> str:
    message = f"{timestamp}{device_id}"
    return hmac.new(device_secret.encode(), message.encode(), hashlib.sha256).hexdigest()


def test_pressure_ingest_can_resolve_patient_from_active_device_session(
    client: TestClient,
    db: Session,
):
    device_id = "device-session-pressure-001"
    patient = _create_patient(db, first_name="Session", last_name="Pressure")
    _register_device(db, device_id=device_id)
    device_session = _create_active_session(
        db,
        patient=patient,
        device_id=device_id,
        measurement_type=DeviceExamMeasurementType.blood_pressure,
    )

    payload = {
        "device_id": device_id,
        "heart_rate": 72,
        "sys_rate": 118,
        "dia_rate": 79,
        "a": None,
        "b": None,
    }
    timestamp = str(int(time.time()))
    headers = {
        "X-Device-Id": device_id,
        "X-Timestamp": timestamp,
        "X-Signature": _sign_request(
            device_secret=os.environ["DEVICE_API_SECRET"],
            device_id=device_id,
            timestamp=timestamp,
        ),
    }

    response = client.post("/device/v1/pressure", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    assert response.json() == {"status": "ok"}

    record = db.scalar(select(PressureRecord).where(PressureRecord.device_id == device_id))
    assert record is not None
    assert record.patient_id == patient.id
    assert record.device_exam_session_id == device_session.id


def test_pressure_ingest_rejects_payload_patient_when_active_session_points_to_other_patient(
    client: TestClient,
    db: Session,
):
    device_id = "device-session-pressure-002"
    active_patient = _create_patient(db, first_name="Active", last_name="Patient")
    payload_patient = _create_patient(db, first_name="Payload", last_name="Patient")
    _register_device(db, device_id=device_id)
    _create_active_session(
        db,
        patient=active_patient,
        device_id=device_id,
        measurement_type=DeviceExamMeasurementType.blood_pressure,
    )

    payload = {
        "user_id": str(payload_patient.id),
        "device_id": device_id,
        "heart_rate": 75,
        "sys_rate": 119,
        "dia_rate": 78,
        "a": None,
        "b": None,
    }
    timestamp = str(int(time.time()))
    headers = {
        "X-Device-Id": device_id,
        "X-Timestamp": timestamp,
        "X-Signature": _sign_request(
            device_secret=os.environ["DEVICE_API_SECRET"],
            device_id=device_id,
            timestamp=timestamp,
        ),
    }

    response = client.post("/device/v1/pressure", json=payload, headers=headers)
    assert response.status_code == 409, response.text
    assert "Payload patient does not match active exam session" in response.json()["detail"]


def test_pressure_ingest_accepts_explicit_session_id_without_payload_patient(
    client: TestClient,
    db: Session,
):
    device_id = "device-session-pressure-003"
    patient = _create_patient(db, first_name="Explicit", last_name="Session")
    _register_device(db, device_id=device_id)
    device_session = _create_active_session(
        db,
        patient=patient,
        device_id=device_id,
        measurement_type=DeviceExamMeasurementType.blood_pressure,
    )

    payload = {
        "session_id": str(device_session.id),
        "device_id": device_id,
        "heart_rate": 73,
        "sys_rate": 121,
        "dia_rate": 80,
        "a": None,
        "b": None,
    }
    timestamp = str(int(time.time()))
    headers = {
        "X-Device-Id": device_id,
        "X-Timestamp": timestamp,
        "X-Signature": _sign_request(
            device_secret=os.environ["DEVICE_API_SECRET"],
            device_id=device_id,
            timestamp=timestamp,
        ),
    }

    response = client.post("/device/v1/pressure", json=payload, headers=headers)
    assert response.status_code == 201, response.text

    record = db.scalar(
        select(PressureRecord)
        .where(PressureRecord.device_exam_session_id == device_session.id)
        .order_by(PressureRecord.created_at.desc())
    )
    assert record is not None
    assert record.patient_id == patient.id
    assert record.device_exam_session_id == device_session.id


def test_heart_sound_ingest_can_resolve_patient_from_active_device_session(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    device_id = "device-session-heart-001"
    patient = _create_patient(db, first_name="Session", last_name="Heart")
    _register_device(db, device_id=device_id)
    device_session = _create_active_session(
        db,
        patient=patient,
        device_id=device_id,
        measurement_type=DeviceExamMeasurementType.heart_sound,
    )
    monkeypatch.setattr(
        "app.services.heart_sound.azure_blob_storage_service.build_read_url",
        lambda storage_key, fallback_url: fallback_url,
    )

    payload = {
        "mac_address": "AA:BB:CC:DD:EE:FF",
        "position": 2,
        "blob_url": "https://example.blob.core.windows.net/heart-sounds/session-heart.wav",
        "storage_key": "heart-sounds/session-heart.wav",
        "mime_type": "audio/wav",
        "duration_seconds": 8,
    }
    payload_raw = json.dumps(payload, separators=(",", ":"))
    timestamp = str(int(time.time()))
    headers = {
        "Content-Type": "application/json",
        "X-Device-Id": device_id,
        "X-Timestamp": timestamp,
        "X-Signature": _sign_request(
            device_secret=os.environ["DEVICE_API_SECRET"],
            device_id=device_id,
            timestamp=timestamp,
        ),
    }

    response = client.post("/device/v1/heart-sounds", content=payload_raw, headers=headers)
    assert response.status_code == 201, response.text

    record = db.scalar(select(HeartSoundRecord).where(HeartSoundRecord.device_id == device_id))
    assert record is not None
    assert record.patient_id == patient.id
    assert record.device_exam_session_id == device_session.id


def test_heart_sound_ingest_accepts_explicit_session_id(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    device_id = "device-session-heart-002"
    patient = _create_patient(db, first_name="Explicit", last_name="Heart")
    _register_device(db, device_id=device_id)
    device_session = _create_active_session(
        db,
        patient=patient,
        device_id=device_id,
        measurement_type=DeviceExamMeasurementType.heart_sound,
    )
    monkeypatch.setattr(
        "app.services.heart_sound.azure_blob_storage_service.build_read_url",
        lambda storage_key, fallback_url: fallback_url,
    )

    payload = {
        "session_id": str(device_session.id),
        "mac_address": "11:22:33:44:55:66",
        "position": 4,
        "blob_url": "https://example.blob.core.windows.net/heart-sounds/explicit-session-heart.wav",
        "storage_key": "heart-sounds/explicit-session-heart.wav",
        "mime_type": "audio/wav",
        "duration_seconds": 6,
    }
    payload_raw = json.dumps(payload, separators=(",", ":"))
    timestamp = str(int(time.time()))
    headers = {
        "Content-Type": "application/json",
        "X-Device-Id": device_id,
        "X-Timestamp": timestamp,
        "X-Signature": _sign_request(
            device_secret=os.environ["DEVICE_API_SECRET"],
            device_id=device_id,
            timestamp=timestamp,
        ),
    }

    response = client.post("/device/v1/heart-sounds", content=payload_raw, headers=headers)
    assert response.status_code == 201, response.text

    record = db.scalar(
        select(HeartSoundRecord)
        .where(HeartSoundRecord.device_exam_session_id == device_session.id)
        .order_by(HeartSoundRecord.created_at.desc())
    )
    assert record is not None
    assert record.patient_id == patient.id
    assert record.device_exam_session_id == device_session.id


def test_device_heartbeat_endpoint_updates_active_session_last_seen(
    client: TestClient,
    db: Session,
):
    device_id = "device-session-heartbeat-001"
    patient = _create_patient(db, first_name="Heartbeat", last_name="Device")
    _register_device(db, device_id=device_id)
    device_session = _create_active_session(
        db,
        patient=patient,
        device_id=device_id,
        measurement_type=DeviceExamMeasurementType.lung_sound,
    )

    timestamp = str(int(time.time()))
    headers = {
        "X-Device-Id": device_id,
        "X-Timestamp": timestamp,
        "X-Signature": _sign_request(
            device_secret=os.environ["DEVICE_API_SECRET"],
            device_id=device_id,
            timestamp=timestamp,
        ),
    }

    response = client.post(
        f"/device/v1/sessions/{device_session.id}/heartbeat",
        headers=headers,
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["session_id"] == str(device_session.id)
    assert payload["last_seen_at"] is not None

    db.refresh(device_session)
    assert device_session.last_seen_at is not None


def test_lung_sound_ingest_can_resolve_patient_from_active_device_session(
    client: TestClient,
    db: Session,
):
    device_id = "device-session-lung-001"
    patient = _create_patient(db, first_name="Session", last_name="Lung")
    _register_device(db, device_id=device_id)
    device_session = _create_active_session(
        db,
        patient=patient,
        device_id=device_id,
        measurement_type=DeviceExamMeasurementType.lung_sound,
    )

    payload = {
        "device_id": device_id,
        "position": 3,
        "blob_url": "https://example.blob.core.windows.net/lung-sounds/session-lung.wav",
        "storage_key": "lung-sounds/session-lung.wav",
        "mime_type": "audio/wav",
        "duration_seconds": 12,
        "sample_rate_hz": 16000,
        "channel_count": 1,
        "wheeze_score": 14,
        "crackle_score": 6,
        "analysis": {"quality": "ok"},
    }
    timestamp = str(int(time.time()))
    headers = {
        "X-Device-Id": device_id,
        "X-Timestamp": timestamp,
        "X-Signature": _sign_request(
            device_secret=os.environ["DEVICE_API_SECRET"],
            device_id=device_id,
            timestamp=timestamp,
        ),
    }

    response = client.post("/device/v1/lung-sounds", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "ok"

    record = db.scalar(select(LungSoundRecord).where(LungSoundRecord.device_id == device_id))
    assert record is not None
    assert record.patient_id == patient.id
    assert record.device_exam_session_id == device_session.id
    assert record.routing_status == DeviceMeasurementRoutingStatus.verified
    assert record.analysis == {"quality": "ok"}


def test_lung_sound_ingest_without_open_session_is_quarantined_as_unmatched(
    client: TestClient,
    db: Session,
):
    device_id = "device-session-lung-unmatched-001"
    _register_device(db, device_id=device_id)

    payload = {
        "device_id": device_id,
        "position": 4,
        "blob_url": "https://example.blob.core.windows.net/lung-sounds/unmatched.wav",
        "storage_key": "lung-sounds/unmatched.wav",
        "mime_type": "audio/wav",
        "duration_seconds": 10,
    }
    timestamp = str(int(time.time()))
    headers = {
        "X-Device-Id": device_id,
        "X-Timestamp": timestamp,
        "X-Signature": _sign_request(
            device_secret=os.environ["DEVICE_API_SECRET"],
            device_id=device_id,
            timestamp=timestamp,
        ),
    }

    response = client.post("/device/v1/lung-sounds", json=payload, headers=headers)
    assert response.status_code == 201, response.text

    record = db.scalar(select(LungSoundRecord).where(LungSoundRecord.device_id == device_id))
    assert record is not None
    assert record.patient_id is None
    assert record.device_exam_session_id is None
    assert record.routing_status == DeviceMeasurementRoutingStatus.unmatched
