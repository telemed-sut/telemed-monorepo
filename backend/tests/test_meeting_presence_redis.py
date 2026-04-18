from datetime import date, datetime, timedelta, timezone

from app.models.enums import MeetingStatus, UserRole
from app.models.meeting import Meeting
from app.models.meeting_room_presence import MeetingRoomPresence
from app.models.patient import Patient
from app.models.user import User
from app.services import meeting_presence as meeting_presence_service
from app.services import redis_runtime as redis_runtime_service


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


def _create_meeting_fixture(db):
    doctor = User(
        email="presence-redis-doctor@example.com",
        password_hash="test_hash",
        role=UserRole.doctor,
    )
    patient = Patient(
        first_name="Presence",
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
    )
    db.add(meeting)
    db.commit()
    db.refresh(meeting)
    return meeting


def test_apply_runtime_presence_overlay_prefers_redis_state(db, monkeypatch):
    fake_redis = FakeRedisHashClient()
    monkeypatch.setattr(meeting_presence_service, "get_redis_client_or_log", lambda *args, **kwargs: fake_redis)

    meeting = _create_meeting_fixture(db)
    stale_time = datetime.now(timezone.utc) - timedelta(minutes=2)
    presence = MeetingRoomPresence(
        meeting_id=meeting.id,
        patient_last_seen_at=stale_time,
        refreshed_at=stale_time,
    )
    db.add(presence)
    db.commit()
    db.refresh(presence)

    fresh_time = datetime.now(timezone.utc)
    fake_redis.hset(
        meeting_presence_service._presence_redis_key(meeting.id),
        {
            "patient_last_seen_at": fresh_time.isoformat(),
            "refreshed_at": fresh_time.isoformat(),
        },
    )

    hydrated = meeting_presence_service.apply_runtime_presence_overlay(presence)
    assert hydrated is not None
    assert hydrated.patient_last_seen_at == fresh_time
    assert hydrated.patient_online is True


def test_touch_doctor_presence_throttles_database_writes_when_redis_available(db, monkeypatch):
    fake_redis = FakeRedisHashClient()
    monkeypatch.setattr(meeting_presence_service, "get_redis_client_or_log", lambda *args, **kwargs: fake_redis)

    meeting = _create_meeting_fixture(db)

    first_presence = meeting_presence_service.touch_doctor_presence(db, meeting)
    first_db_timestamp = first_presence.doctor_last_seen_at
    assert first_db_timestamp is not None

    second_presence = meeting_presence_service.touch_doctor_presence(db, meeting)
    db.refresh(meeting)
    db_presence = meeting.room_presence
    assert db_presence is not None

    assert MeetingRoomPresence._ensure_utc(db_presence.doctor_last_seen_at) == first_db_timestamp
    assert second_presence.doctor_online is True
    assert MeetingRoomPresence._ensure_utc(second_presence.doctor_last_seen_at) >= first_db_timestamp


def test_apply_runtime_presence_overlay_falls_back_cleanly_when_redis_unavailable(db, monkeypatch):
    redis_runtime_service.reset_runtime_diagnostics()
    monkeypatch.setattr(
        meeting_presence_service,
        "get_redis_client_or_log",
        lambda *args, **kwargs: None,
    )

    meeting = _create_meeting_fixture(db)
    stale_time = datetime.now(timezone.utc) - timedelta(minutes=2)
    presence = MeetingRoomPresence(
        meeting_id=meeting.id,
        patient_last_seen_at=stale_time,
        refreshed_at=stale_time,
    )
    db.add(presence)
    db.commit()
    db.refresh(presence)

    hydrated = meeting_presence_service.apply_runtime_presence_overlay(presence)
    assert hydrated is presence
    assert MeetingRoomPresence._ensure_utc(hydrated.patient_last_seen_at) == stale_time
