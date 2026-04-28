from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.models.enums import MeetingStatus, UserRole
from app.models.meeting import Meeting
from app.models.patient import Patient
from app.models.user import User
from app.services import meeting_video as meeting_video_service


class FakeRedisHashClient:
    def __init__(self):
        self.hashes = {}
        self.expirations = {}

    def hset(self, key, mapping):
        current = self.hashes.setdefault(key, {})
        current.update(mapping)
        return len(mapping)

    def hgetall(self, key):
        return dict(self.hashes.get(key, {}))

    def expire(self, key, ttl):
        self.expirations[key] = ttl
        return True

    def delete(self, *keys):
        deleted = 0
        for key in keys:
            if key in self.hashes:
                deleted += 1
            self.hashes.pop(key, None)
            self.expirations.pop(key, None)
        return deleted


def _create_meeting_fixture(db):
    doctor = User(
        email="meeting-video-redis-doctor@example.com",
        password_hash="test_hash",
        role=UserRole.doctor,
    )
    patient = Patient(
        first_name="Meeting",
        last_name="Redis",
        date_of_birth=date(1990, 1, 1),
    )
    db.add_all([doctor, patient])
    db.commit()
    db.refresh(doctor)
    db.refresh(patient)

    meeting = Meeting(
        doctor_id=doctor.id,
        user_id=patient.id,
        status=MeetingStatus.scheduled,
        date_time=datetime.now(timezone.utc) + timedelta(hours=1),
    )
    db.add(meeting)
    db.commit()
    db.refresh(meeting)
    return meeting, doctor


def test_extract_meeting_id_from_patient_short_code_uses_redis_cache(db, monkeypatch):
    fake_redis = FakeRedisHashClient()
    monkeypatch.setattr(meeting_video_service, "_get_meeting_video_redis_client", lambda: fake_redis)

    meeting, doctor = _create_meeting_fixture(db)
    invite = meeting_video_service.create_patient_join_invite(
        db=db,
        meeting=meeting,
        created_by_user_id=str(doctor.id),
    )
    short_code = invite["short_code"]

    resolved_meeting_id = meeting_video_service.extract_meeting_id_from_patient_short_code(
        db=db,
        short_code=short_code,
    )
    assert resolved_meeting_id == str(meeting.id)

    def fail_scalar(*args, **kwargs):
        raise AssertionError("database lookup should not happen on a warm short-code cache hit")

    monkeypatch.setattr(db, "scalar", fail_scalar)
    cached_meeting_id = meeting_video_service.extract_meeting_id_from_patient_short_code(
        db=db,
        short_code=short_code,
    )

    assert cached_meeting_id == str(meeting.id)


def test_deactivate_patient_join_invites_clears_short_code_cache(db, monkeypatch):
    fake_redis = FakeRedisHashClient()
    monkeypatch.setattr(meeting_video_service, "_get_meeting_video_redis_client", lambda: fake_redis)

    meeting, doctor = _create_meeting_fixture(db)
    invite = meeting_video_service.create_patient_join_invite(
        db=db,
        meeting=meeting,
        created_by_user_id=str(doctor.id),
    )
    short_code = invite["short_code"]

    meeting_video_service.extract_meeting_id_from_patient_short_code(
        db=db,
        short_code=short_code,
    )
    cache_key = meeting_video_service._patient_short_code_cache_key(short_code)
    assert fake_redis.hgetall(cache_key)

    meeting_video_service.deactivate_patient_join_invites(
        db=db,
        meeting=meeting,
    )

    assert fake_redis.hgetall(cache_key) == {}
    with pytest.raises(HTTPException, match="Patient short code expired"):
        meeting_video_service.extract_meeting_id_from_patient_short_code(
            db=db,
            short_code=short_code,
        )


def test_extract_meeting_id_from_patient_short_code_falls_back_when_redis_unavailable(db, monkeypatch):
    meeting, doctor = _create_meeting_fixture(db)
    invite = meeting_video_service.create_patient_join_invite(
        db=db,
        meeting=meeting,
        created_by_user_id=str(doctor.id),
    )

    monkeypatch.setattr(meeting_video_service, "_get_meeting_video_redis_client", lambda: None)

    resolved_meeting_id = meeting_video_service.extract_meeting_id_from_patient_short_code(
        db=db,
        short_code=invite["short_code"],
    )

    assert resolved_meeting_id == str(meeting.id)
