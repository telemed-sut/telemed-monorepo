from app.services import audit as audit_service
from app.services import global_presence as global_presence_service
from app.services import idempotency as idempotency_service
from app.services import pubsub as pubsub_service


class FakePublishRedisClient:
    def __init__(self):
        self.published: list[tuple[str, str]] = []

    def publish(self, channel: str, payload: str) -> int:
        self.published.append((channel, payload))
        return 1


class FakePresenceRedisClient:
    def __init__(self):
        self.members: dict[str, int] = {}

    def zadd(self, key: str, mapping: dict[str, int]) -> int:
        self.members.update(mapping)
        return len(mapping)

    def zremrangebyscore(self, key: str, min_score: str, max_score: int) -> int:
        removed = [member for member, score in self.members.items() if score <= max_score]
        for member in removed:
            self.members.pop(member, None)
        return len(removed)

    def zrangebyscore(self, key: str, min_score: int, max_score: str) -> list[str]:
        return [member for member, score in self.members.items() if score >= min_score]

    def zscore(self, key: str, user_id: str):
        return self.members.get(user_id)


class FakeIdempotencyRedisClient:
    def __init__(self):
        self.values: dict[str, str] = {}

    def get(self, key: str):
        return self.values.get(key)

    def set(self, key: str, value: str, nx: bool = False, ex: int | None = None):
        if nx and key in self.values:
            return False
        self.values[key] = value
        return True


class FakeAuditRedisClient:
    def __init__(self):
        self.items: list[tuple[str, str]] = []

    def lpush(self, key: str, payload: str) -> int:
        self.items.append((key, payload))
        return len(self.items)


def test_publish_realtime_event_returns_false_without_redis(monkeypatch):
    monkeypatch.setattr(pubsub_service, "get_redis_client_or_log", lambda *args, **kwargs: None)

    assert pubsub_service.publish_realtime_event("patient:1:events", "updated", {"ok": True}) is False


def test_publish_realtime_event_uses_redis_when_available(monkeypatch):
    fake_redis = FakePublishRedisClient()
    monkeypatch.setattr(pubsub_service, "get_redis_client_or_log", lambda *args, **kwargs: fake_redis)

    assert pubsub_service.publish_realtime_event("patient:1:events", "updated", {"ok": True}) is True
    assert fake_redis.published


def test_global_presence_returns_empty_defaults_without_redis(monkeypatch):
    monkeypatch.setattr(global_presence_service, "_get_presence_redis_client", lambda: None)

    global_presence_service.touch_global_presence("user-1")
    assert global_presence_service.cleanup_expired_presence() == 0
    assert global_presence_service.get_online_user_ids() == []
    assert global_presence_service.is_user_online("user-1") is False


def test_global_presence_uses_redis_when_available(monkeypatch):
    fake_redis = FakePresenceRedisClient()
    monkeypatch.setattr(global_presence_service, "_get_presence_redis_client", lambda: fake_redis)
    monkeypatch.setattr(global_presence_service.time, "time", lambda: 1_000)

    global_presence_service.touch_global_presence("user-1")

    assert "user-1" in global_presence_service.get_online_user_ids()
    assert global_presence_service.is_user_online("user-1") is True


def test_idempotency_falls_back_without_redis(monkeypatch):
    monkeypatch.setattr(idempotency_service, "_get_idempotency_redis_client", lambda: None)

    assert idempotency_service.check_idempotency("key", "user") is None
    assert idempotency_service.lock_idempotency("key", "user") is True
    assert idempotency_service.save_idempotency_response("key", "user", {"ok": True}) is None


def test_idempotency_uses_cached_response_when_available(monkeypatch):
    fake_redis = FakeIdempotencyRedisClient()
    fake_redis.values["idempotency:v1:user:key"] = '{"ok": true}'
    monkeypatch.setattr(idempotency_service, "_get_idempotency_redis_client", lambda: fake_redis)

    assert idempotency_service.check_idempotency("key", "user") == {"ok": True}


def test_audit_buffer_returns_false_without_redis(monkeypatch):
    monkeypatch.setattr(audit_service, "get_redis_client_or_log", lambda *args, **kwargs: None)

    assert audit_service.push_to_audit_buffer({"action": "test"}) is False


def test_audit_buffer_pushes_when_redis_available(monkeypatch):
    fake_redis = FakeAuditRedisClient()
    monkeypatch.setattr(audit_service, "get_redis_client_or_log", lambda *args, **kwargs: fake_redis)

    assert audit_service.push_to_audit_buffer({"action": "test"}) is True
    assert fake_redis.items
