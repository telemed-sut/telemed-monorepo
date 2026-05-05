import importlib

from app.core.config import get_settings


BASELINE_ENV = {
    "DATABASE_URL": "sqlite:///:memory:",
    "JWT_SECRET": "jwt_secret_1234567890abcdef1234567890",
    "JWT_EXPIRES_IN": "3600",
    "DEVICE_API_SECRET": "device_secret_1234567890abcdef1234567890",
    "DEVICE_API_REQUIRE_REGISTERED_DEVICE": "false",
    "DEVICE_API_REQUIRE_BODY_HASH_SIGNATURE": "false",
    "DEVICE_API_REQUIRE_NONCE": "false",
    "DEVICE_SECRET_ENCRYPTION_KEY": "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    "TWO_FACTOR_SECRET_ENCRYPTION_KEY": "ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=",
    "ALLOW_INSECURE_SECRET_STORAGE": "false",
    "MEETING_SIGNING_SECRET": "meeting_signing_secret_1234567890abcdef1234567890",
}


def _apply_env(monkeypatch, **overrides) -> None:
    for key, value in BASELINE_ENV.items():
        monkeypatch.setenv(key, value)

    for key, value in overrides.items():
        if value is None:
            monkeypatch.delenv(key, raising=False)
            continue
        monkeypatch.setenv(key, value)


def test_production_without_redis_uses_memory_rate_limiter(monkeypatch):
    _apply_env(
        monkeypatch,
        APP_ENV="production",
        REDIS_URL=None,
        DEVICE_API_REQUIRE_REGISTERED_DEVICE="true",
        DEVICE_API_REQUIRE_BODY_HASH_SIGNATURE="true",
        DEVICE_API_REQUIRE_NONCE="true",
    )
    get_settings.cache_clear()

    import app.core.limiter as limiter_module

    try:
        limiter_module = importlib.reload(limiter_module)

        assert limiter_module.storage_uri == "memory://"
        assert limiter_module.storage_options == {}
    finally:
        _apply_env(monkeypatch, APP_ENV="test", REDIS_URL=None)
        get_settings.cache_clear()
        importlib.reload(limiter_module)


def test_rate_limiter_ignores_legacy_redis_url(monkeypatch):
    _apply_env(
        monkeypatch,
        APP_ENV="production",
        REDIS_URL="redis://rate-limit-cache:6379/0",
        DEVICE_API_REQUIRE_REGISTERED_DEVICE="true",
        DEVICE_API_REQUIRE_BODY_HASH_SIGNATURE="true",
        DEVICE_API_REQUIRE_NONCE="true",
    )
    get_settings.cache_clear()

    import app.db.session as session_module
    import app.core.limiter as limiter_module

    session_module = importlib.reload(session_module)
    limiter_module = importlib.reload(limiter_module)

    try:
        assert session_module.get_redis_connection_pool() is None
        assert session_module.get_redis_client() is None
        assert limiter_module.storage_uri == "memory://"
        assert limiter_module.storage_options == {}
    finally:
        _apply_env(monkeypatch, APP_ENV="test", REDIS_URL=None)
        session_module.reset_redis_runtime_state()
        get_settings.cache_clear()
        importlib.reload(session_module)
        importlib.reload(limiter_module)
