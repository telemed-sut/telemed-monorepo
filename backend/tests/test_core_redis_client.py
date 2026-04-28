from types import SimpleNamespace

from app.core import redis_client as redis_client_module


class FakeRedisProxyClient:
    def __init__(self):
        self.calls: list[tuple[str, tuple, dict]] = []

    def set(self, *args, **kwargs):
        self.calls.append(("set", args, kwargs))
        return True

    def ping(self):
        self.calls.append(("ping", (), {}))
        return True


def test_redis_client_proxy_forwards_to_shared_client(monkeypatch):
    fake_redis = FakeRedisProxyClient()
    monkeypatch.setattr(redis_client_module, "get_shared_redis_client", lambda: fake_redis)

    assert redis_client_module.redis_client.set("key", "value") is True
    assert fake_redis.calls == [("set", ("key", "value"), {})]


def test_distributed_lock_allows_test_fallback_without_redis(monkeypatch):
    monkeypatch.setattr(redis_client_module, "get_shared_redis_client", lambda: None)
    monkeypatch.setattr(redis_client_module, "settings", SimpleNamespace(app_env="test"))

    with redis_client_module.distributed_lock("test-lock") as acquired:
        assert acquired is True


def test_check_redis_connection_returns_false_without_client(monkeypatch):
    monkeypatch.setattr(redis_client_module, "get_shared_redis_client", lambda: None)

    assert redis_client_module.check_redis_connection() is False
