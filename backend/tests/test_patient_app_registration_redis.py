from datetime import date, datetime, timedelta, timezone

from app.core.security import verify_password
from app.models.patient import Patient
from app.models.patient_app_registration import PatientAppRegistration
from app.services import patient_app as patient_app_service


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


def _create_patient(db, *, phone="+66812345678") -> Patient:
    patient = Patient(
        first_name="Redis",
        last_name="Registration",
        phone=phone,
        date_of_birth=date(1990, 1, 1),
        is_active=True,
    )
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


def _create_registration_code(db, *, patient_id, code="ABCD23") -> PatientAppRegistration:
    registration = PatientAppRegistration(
        patient_id=patient_id,
        code=code,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    )
    db.add(registration)
    db.commit()
    db.refresh(registration)
    return registration


def test_resolve_active_registration_uses_redis_cache_after_warm(db, monkeypatch):
    fake_redis = FakeRedisHashClient()
    monkeypatch.setattr(patient_app_service, "_get_patient_registration_redis_client", lambda: fake_redis)

    patient = _create_patient(db)
    registration = _create_registration_code(db, patient_id=patient.id, code="CACHE1")

    first = patient_app_service._resolve_active_registration(
        db=db,
        normalized_code="CACHE1",
    )
    assert first is not None
    assert first.id == registration.id

    def fail_scalar(*args, **kwargs):
        raise AssertionError("database code lookup should not happen on a warm cache hit")

    monkeypatch.setattr(db, "scalar", fail_scalar)
    cached = patient_app_service._resolve_active_registration(
        db=db,
        normalized_code="CACHE1",
    )

    assert cached is not None
    assert cached.id == registration.id


def test_register_patient_app_consumes_code_and_clears_cache(db, monkeypatch):
    fake_redis = FakeRedisHashClient()
    monkeypatch.setattr(patient_app_service, "_get_patient_registration_redis_client", lambda: fake_redis)

    patient = _create_patient(db)
    registration = _create_registration_code(db, patient_id=patient.id, code="REG123")

    patient_app_service._resolve_active_registration(
        db=db,
        normalized_code="REG123",
    )
    cache_key = patient_app_service._registration_cache_key("REG123")
    assert fake_redis.hgetall(cache_key)

    payload = patient_app_service.register_patient_app(
        db=db,
        phone="0812345678",
        code="reg123",
        pin="123456",
        user_agent="patient-registration-cache/1.0",
    )

    assert payload["patient_id"] == str(patient.id)
    db.refresh(patient)
    db.refresh(registration)
    assert verify_password("123456", patient.pin_hash)
    assert registration.is_used is True
    assert fake_redis.hgetall(cache_key) == {}


def test_create_registration_code_invalidates_previous_cached_code(db, monkeypatch):
    fake_redis = FakeRedisHashClient()
    monkeypatch.setattr(patient_app_service, "_get_patient_registration_redis_client", lambda: fake_redis)

    patient = _create_patient(db, phone="+66812345679")
    previous = _create_registration_code(db, patient_id=patient.id, code="OLD123")
    patient_app_service._resolve_active_registration(
        db=db,
        normalized_code="OLD123",
    )
    previous_cache_key = patient_app_service._registration_cache_key("OLD123")
    assert fake_redis.hgetall(previous_cache_key)

    created = patient_app_service.create_registration_code(
        db=db,
        patient_id=str(patient.id),
    )

    db.refresh(previous)
    assert previous.is_used is True
    assert fake_redis.hgetall(previous_cache_key) == {}

    new_cache_key = patient_app_service._registration_cache_key(created["code"])
    assert fake_redis.hgetall(new_cache_key)


def test_register_patient_app_falls_back_when_redis_unavailable(db, monkeypatch):
    patient = _create_patient(db, phone="+66812345680")
    registration = _create_registration_code(db, patient_id=patient.id, code="FALLB4")
    monkeypatch.setattr(patient_app_service, "_get_patient_registration_redis_client", lambda: None)

    payload = patient_app_service.register_patient_app(
        db=db,
        phone="0812345680",
        code="fallb4",
        pin="654321",
        user_agent="patient-registration-fallback/1.0",
    )

    assert payload["patient_id"] == str(patient.id)
    db.refresh(registration)
    db.refresh(patient)
    assert registration.is_used is True
    assert verify_password("654321", patient.pin_hash)
