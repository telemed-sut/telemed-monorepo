from app.services import redis_cache


class FakeRedisCacheClient:
    def __init__(self):
        self.values: dict[str, str] = {}

    def get(self, key: str):
        return self.values.get(key)

    def incr(self, key: str) -> int:
        next_value = int(self.values.get(key, "0")) + 1
        self.values[key] = str(next_value)
        return next_value


def test_dashboard_stats_cache_key_uses_versioned_namespace(monkeypatch):
    fake_redis = FakeRedisCacheClient()
    fake_redis.values["stats:overview:v3:namespace"] = "7"
    monkeypatch.setattr(redis_cache, "get_redis_client", lambda: fake_redis)

    cache_key = redis_cache.get_dashboard_stats_cache_key(
        role="admin",
        user_id="user-123",
        year=2026,
    )

    assert cache_key == "stats:overview:v3:7:admin:user-123:2026"


def test_clear_dashboard_stats_cache_bumps_namespace(monkeypatch):
    fake_redis = FakeRedisCacheClient()
    fake_redis.values["stats:overview:v3:namespace"] = "3"
    monkeypatch.setattr(redis_cache, "get_redis_client", lambda: fake_redis)

    redis_cache.clear_dashboard_stats_cache()

    assert fake_redis.values["stats:overview:v3:namespace"] == "4"
