import importlib

import pytest
import slowapi.extension as slowapi_extension
from limits import parse
from limits.storage.memory import MemoryStorage
from pydantic import ValidationError
from slowapi import Limiter

from app.core.config import get_settings


BASELINE_ENV = {
    "DATABASE_URL": "sqlite:///:memory:",
    "JWT_SECRET": "jwt_secret_1234567890abcdef1234567890",
    "JWT_EXPIRES_IN": "3600",
    "DEVICE_API_SECRET": "device_secret_1234567890abcdef1234567890",
    "DEVICE_API_REQUIRE_REGISTERED_DEVICE": "false",
}


def _apply_env(monkeypatch, **overrides) -> None:
    for key, value in BASELINE_ENV.items():
        monkeypatch.setenv(key, value)

    for key, value in overrides.items():
        if value is None:
            monkeypatch.delenv(key, raising=False)
            continue
        monkeypatch.setenv(key, value)


def test_production_without_redis_fails_rate_limiter_startup(monkeypatch):
    _apply_env(monkeypatch, APP_ENV="production", REDIS_URL=None)
    get_settings.cache_clear()

    import app.core.limiter as limiter_module

    try:
        with pytest.raises(ValidationError, match="REDIS_URL is required when APP_ENV=production"):
            importlib.reload(limiter_module)
    finally:
        _apply_env(monkeypatch, APP_ENV="test", REDIS_URL=None)
        get_settings.cache_clear()
        importlib.reload(limiter_module)


def test_redis_backed_rate_limiter_shares_state_across_instances(monkeypatch, mock_redis_module):
    _apply_env(
        monkeypatch,
        APP_ENV="production",
        REDIS_URL="redis://rate-limit-cache:6379/0",
    )
    get_settings.cache_clear()

    shared_storage_by_uri: dict[str, MemoryStorage] = {}
    captured_storage_config: dict[str, object] = {}
    real_storage_from_string = slowapi_extension.storage_from_string

    def fake_storage_from_string(storage_string: str, **options):
        if storage_string.startswith("redis://"):
            captured_storage_config["storage_string"] = storage_string
            captured_storage_config["options"] = options
            return shared_storage_by_uri.setdefault(storage_string, MemoryStorage("memory://"))
        return real_storage_from_string(storage_string, **options)

    monkeypatch.setattr(slowapi_extension, "storage_from_string", fake_storage_from_string)

    import app.db.session as session_module
    import app.core.limiter as limiter_module

    session_module = importlib.reload(session_module)
    limiter_module = importlib.reload(limiter_module)

    try:
        first_pool = session_module.get_redis_connection_pool()
        second_pool = session_module.get_redis_connection_pool()
        first_client = session_module.get_redis_client()
        second_client = session_module.get_redis_client()

        assert first_pool is second_pool
        assert first_client is second_client
        assert first_client.connection_pool is first_pool
        assert len(mock_redis_module.ConnectionPool.created_pools) == 1
        assert len(mock_redis_module.Redis.created_clients) == 1

        assert limiter_module.storage_uri == "redis://rate-limit-cache:6379/0"
        assert limiter_module.storage_options["connection_pool"] is first_pool
        assert captured_storage_config["storage_string"] == "redis://rate-limit-cache:6379/0"
        assert captured_storage_config["options"]["connection_pool"] is first_pool

        limit = parse("2/minute")
        second_instance = Limiter(
            key_func=lambda _request: "shared-user",
            default_limits=["2/minute"],
            storage_uri="redis://rate-limit-cache:6379/0",
            storage_options={"connection_pool": first_pool},
        )

        assert limiter_module.limiter._limiter.hit(limit, "shared-user") is True
        assert second_instance._limiter.hit(limit, "shared-user") is True
        assert limiter_module.limiter._limiter.hit(limit, "shared-user") is False
    finally:
        _apply_env(monkeypatch, APP_ENV="test", REDIS_URL=None)
        session_module.reset_redis_runtime_state()
        get_settings.cache_clear()
        importlib.reload(session_module)
        importlib.reload(limiter_module)
