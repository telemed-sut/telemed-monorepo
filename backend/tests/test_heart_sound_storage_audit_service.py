from datetime import datetime, timezone

from app.models.heart_sound_record import HeartSoundRecord
from app.services.heart_sound_storage_audit import heart_sound_storage_audit_service

from tests.test_heart_sound_api import _create_patient


def test_audit_records_flags_legacy_storage_key(db, monkeypatch):
    patient = _create_patient(db)
    record = HeartSoundRecord(
        patient_id=patient.id,
        device_id="device-1",
        mac_address="AA:BB:CC:DD:EE:FF",
        position=2,
        blob_url="https://example.blob.core.windows.net/heart-sounds/heart-sounds/patient-1.wav",
        storage_key="heart-sounds/patient-1.wav",
        mime_type="audio/wav",
        recorded_at=datetime.now(timezone.utc),
    )
    db.add(record)
    db.commit()

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

    summary = heart_sound_storage_audit_service.audit_records(db, limit=10, mismatches_only=True)

    assert summary.total_records == 1
    assert summary.scanned_count == 1
    assert summary.inconsistent_count == 1
    assert summary.issue_counts == {"legacy_storage_key_prefix": 1}
    assert len(summary.items) == 1
    assert summary.items[0].normalized_storage_key == "patient-1.wav"
    assert summary.items[0].issues == ["legacy_storage_key_prefix"]
