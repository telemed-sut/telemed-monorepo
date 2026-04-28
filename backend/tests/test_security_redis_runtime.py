from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.api import security as security_api
from app.core.security import get_password_hash
from app.models.enums import UserRole
from app.models.ip_ban import IPBan
from app.models.user import User
from app.services import security as security_service
from app.services.auth import create_login_response


class FakeRedisSecurityClient:
    def __init__(self):
        self.values = {}
        self.expirations = {}

    def setex(self, key, ttl, value):
        self.values[key] = value
        self.expirations[key] = ttl
        return True

    def get(self, key):
        return self.values.get(key)

    def delete(self, *keys):
        for key in keys:
            self.values.pop(key, None)
            self.expirations.pop(key, None)
        return len(keys)

    def incr(self, key):
        current = int(self.values.get(key, 0)) + 1
        self.values[key] = current
        return current

    def expire(self, key, ttl):
        self.expirations[key] = ttl
        return True


def _make_admin(db, email: str) -> User:
    admin = User(
        email=email,
        password_hash=get_password_hash("TestPass123"),
        role=UserRole.admin,
        is_active=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


def _auth_headers(user: User, db) -> dict[str, str]:
    token = create_login_response(user, db=db)["access_token"]
    db.commit()
    return {"Authorization": f"Bearer {token}"}


def test_check_ip_banned_uses_redis_runtime_cache(db, monkeypatch):
    fake_redis = FakeRedisSecurityClient()
    monkeypatch.setattr(security_service, "_get_security_redis_client", lambda: fake_redis)

    banned_until = datetime.now(timezone.utc) + timedelta(minutes=10)
    security_service.cache_ip_ban("8.8.8.8", banned_until=banned_until)

    cached_ban = security_service.check_ip_banned(db, "8.8.8.8")
    assert cached_ban is not None
    assert cached_ban.ip_address == "8.8.8.8"


def test_handle_failed_login_uses_redis_counter_to_create_ban(db, monkeypatch):
    fake_redis = FakeRedisSecurityClient()
    monkeypatch.setattr(security_service, "_get_security_redis_client", lambda: fake_redis)
    monkeypatch.setattr(security_service.settings, "ip_ban_threshold", 2)
    monkeypatch.setattr(security_service.settings, "ip_attempt_window_minutes", 15)
    monkeypatch.setattr(security_service.settings, "ip_ban_duration_minutes", 30)

    security_service.handle_failed_login(db, "8.8.4.4", "redis-counter@example.com", None)
    security_service.handle_failed_login(db, "8.8.4.4", "redis-counter@example.com", None)
    db.commit()

    ban = db.scalar(select(IPBan).where(IPBan.ip_address == "8.8.4.4"))
    assert ban is not None
    assert ban.failed_attempts == 2

    cached_ban = security_service.check_ip_banned(db, "8.8.4.4")
    assert cached_ban is not None


def test_unban_ip_clears_redis_runtime_state(client, db, monkeypatch):
    fake_redis = FakeRedisSecurityClient()
    monkeypatch.setattr(security_service, "_get_security_redis_client", lambda: fake_redis)

    admin = _make_admin(db, "redis-unban-admin@example.com")
    banned_until = datetime.now(timezone.utc) + timedelta(hours=1)
    ban = IPBan(
        ip_address="1.1.1.1",
        reason="Redis runtime clear",
        failed_attempts=3,
        banned_until=banned_until,
    )
    db.add(ban)
    db.commit()

    security_service.cache_ip_ban("1.1.1.1", banned_until=banned_until)
    assert fake_redis.get(security_service._ip_ban_key("1.1.1.1")) is not None

    response = client.delete(
        "/security/ip-bans/1.1.1.1",
        headers=_auth_headers(admin, db),
    )

    assert response.status_code == 200, response.text
    assert fake_redis.get(security_service._ip_ban_key("1.1.1.1")) is None
