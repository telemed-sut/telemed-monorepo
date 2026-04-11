from datetime import date

import pytest
from fastapi import HTTPException

from app.models.enums import UserRole
from app.models.patient import Patient
from app.models.user import User
from app.services import auth_sessions
from app.services import patient_app_sessions


class FakeRedisSessionClient:
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


def _credentials_exception() -> HTTPException:
    return HTTPException(status_code=401, detail="Invalid or expired token")


def _make_user(db, email: str) -> User:
    user = User(
        email=email,
        password_hash="hashed-password",
        role=UserRole.admin,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _make_patient(db, phone: str) -> Patient:
    patient = Patient(
        first_name="Redis",
        last_name="Session",
        phone=phone,
        date_of_birth=date(1990, 1, 1),
        is_active=True,
    )
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


def test_require_active_session_uses_redis_cache_after_warm(db, monkeypatch):
    fake_redis = FakeRedisSessionClient()
    monkeypatch.setattr(auth_sessions, "_get_session_redis_client", lambda: fake_redis)

    user = _make_user(db, "session-cache@example.com")
    auth_sessions.register_session(
        db,
        user_id=user.id,
        session_id="staff-session-cache",
        auth_source="local",
        expires_in_seconds=3600,
    )
    db.commit()

    first_session = auth_sessions.require_active_session(
        db,
        user_id=user.id,
        session_id="staff-session-cache",
        credentials_exception=_credentials_exception(),
    )
    assert first_session.session_id == "staff-session-cache"

    def fail_scalar(*args, **kwargs):
        raise AssertionError("database lookup should not happen on a warm cache hit")

    monkeypatch.setattr(db, "scalar", fail_scalar)
    cached_session = auth_sessions.require_active_session(
        db,
        user_id=user.id,
        session_id="staff-session-cache",
        credentials_exception=_credentials_exception(),
    )

    assert cached_session.session_id == "staff-session-cache"
    assert cached_session.user_id == user.id


def test_revoke_session_clears_redis_cache_and_blocks_follow_up(db, monkeypatch):
    fake_redis = FakeRedisSessionClient()
    monkeypatch.setattr(auth_sessions, "_get_session_redis_client", lambda: fake_redis)

    user = _make_user(db, "session-revoke@example.com")
    auth_sessions.register_session(
        db,
        user_id=user.id,
        session_id="staff-session-revoke",
        auth_source="local",
        expires_in_seconds=3600,
    )
    db.commit()

    auth_sessions.require_active_session(
        db,
        user_id=user.id,
        session_id="staff-session-revoke",
        credentials_exception=_credentials_exception(),
    )
    cache_key = auth_sessions._session_cache_key("staff-session-revoke")
    assert fake_redis.hgetall(cache_key)

    revoked = auth_sessions.revoke_session(db, session_id="staff-session-revoke")
    db.commit()

    assert revoked is True
    assert fake_redis.hgetall(cache_key) == {}
    with pytest.raises(HTTPException):
        auth_sessions.require_active_session(
            db,
            user_id=user.id,
            session_id="staff-session-revoke",
            credentials_exception=_credentials_exception(),
        )


def test_patient_session_uses_redis_cache_without_requerying_each_request(db, monkeypatch):
    fake_redis = FakeRedisSessionClient()
    monkeypatch.setattr(patient_app_sessions, "_get_patient_session_redis_client", lambda: fake_redis)

    patient = _make_patient(db, "+66810000001")
    patient_app_sessions.register_patient_session(
        db,
        patient_id=patient.id,
        session_id="patient-session-cache",
        expires_in_seconds=3600,
    )
    db.commit()

    first_session = patient_app_sessions.require_active_patient_session(
        db,
        patient_id=patient.id,
        session_id="patient-session-cache",
        credentials_exception=_credentials_exception(),
    )
    assert first_session.session_id == "patient-session-cache"

    def fail_scalar(*args, **kwargs):
        raise AssertionError("database lookup should not happen on a warm patient cache hit")

    monkeypatch.setattr(db, "scalar", fail_scalar)
    cached_session = patient_app_sessions.require_active_patient_session(
        db,
        patient_id=patient.id,
        session_id="patient-session-cache",
        credentials_exception=_credentials_exception(),
    )

    assert cached_session.session_id == "patient-session-cache"
    assert cached_session.patient_id == patient.id


def test_revoke_patient_session_clears_redis_cache_and_blocks_follow_up(db, monkeypatch):
    fake_redis = FakeRedisSessionClient()
    monkeypatch.setattr(patient_app_sessions, "_get_patient_session_redis_client", lambda: fake_redis)

    patient = _make_patient(db, "+66810000002")
    patient_app_sessions.register_patient_session(
        db,
        patient_id=patient.id,
        session_id="patient-session-revoke",
        expires_in_seconds=3600,
    )
    db.commit()

    patient_app_sessions.require_active_patient_session(
        db,
        patient_id=patient.id,
        session_id="patient-session-revoke",
        credentials_exception=_credentials_exception(),
    )
    cache_key = patient_app_sessions._session_cache_key("patient-session-revoke")
    assert fake_redis.hgetall(cache_key)

    revoked = patient_app_sessions.revoke_patient_session(
        db,
        session_id="patient-session-revoke",
    )
    db.commit()

    assert revoked is True
    assert fake_redis.hgetall(cache_key) == {}
    with pytest.raises(HTTPException):
        patient_app_sessions.require_active_patient_session(
            db,
            patient_id=patient.id,
            session_id="patient-session-revoke",
            credentials_exception=_credentials_exception(),
        )
