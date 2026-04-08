import pytest
from pydantic import ValidationError

from app.core.config import Settings, get_settings


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


def _clear_settings_cache() -> None:
    get_settings.cache_clear()


def test_settings_accepts_json_device_api_secrets(monkeypatch):
    _apply_env(
        monkeypatch,
        DEVICE_API_SECRETS='{"device-json-001":"device_secret_json_1234567890abcdef1234567890"}',
    )

    settings = Settings()

    assert settings.device_api_secrets == {
        "device-json-001": "device_secret_json_1234567890abcdef1234567890"
    }


def test_settings_normalizes_postgresql_database_url_to_psycopg(monkeypatch):
    _apply_env(
        monkeypatch,
        DATABASE_URL="postgresql://user:password@localhost:5432/patient_db",
    )

    settings = Settings()

    assert settings.database_url == "postgresql+psycopg://user:password@localhost:5432/patient_db"


def test_settings_normalizes_postgres_alias_database_url_to_psycopg(monkeypatch):
    _apply_env(
        monkeypatch,
        DATABASE_URL="postgres://user:password@localhost:5432/patient_db",
    )

    settings = Settings()

    assert settings.database_url == "postgresql+psycopg://user:password@localhost:5432/patient_db"


def test_settings_preserves_explicit_database_driver(monkeypatch):
    _apply_env(
        monkeypatch,
        DATABASE_URL="postgresql+psycopg://user:password@localhost:5432/patient_db",
    )

    settings = Settings()

    assert settings.database_url == "postgresql+psycopg://user:password@localhost:5432/patient_db"


def test_settings_accepts_comma_separated_device_api_secrets(monkeypatch):
    _apply_env(
        monkeypatch,
        DEVICE_API_SECRETS=(
            "device-a=device_secret_a_1234567890abcdef1234567890,"
            "device-b=device_secret_b_1234567890abcdef1234567890"
        ),
    )

    settings = Settings()

    assert settings.device_api_secrets == {
        "device-a": "device_secret_a_1234567890abcdef1234567890",
        "device-b": "device_secret_b_1234567890abcdef1234567890",
    }


def test_settings_enable_api_docs_by_default_in_development(monkeypatch):
    _apply_env(monkeypatch, APP_ENV="development", API_DOCS_ENABLED=None)

    settings = Settings()

    assert settings.should_enable_api_docs is True


def test_settings_disable_api_docs_by_default_in_production(monkeypatch):
    _apply_env(
        monkeypatch,
        APP_ENV="production",
        API_DOCS_ENABLED=None,
        REDIS_URL="redis://rate-limit-cache:6379/0",
    )

    settings = Settings()

    assert settings.should_enable_api_docs is False


def test_settings_resolve_allowed_hosts_for_local_environments(monkeypatch):
    _apply_env(monkeypatch, APP_ENV="test", ALLOWED_HOSTS=None)

    settings = Settings()

    assert settings.resolved_allowed_hosts == ["localhost", "127.0.0.1", "::1", "testserver"]


def test_settings_accept_explicit_allowed_hosts(monkeypatch):
    _apply_env(monkeypatch, ALLOWED_HOSTS="api.example.com,internal.example.com")

    settings = Settings()

    assert settings.resolved_allowed_hosts == ["api.example.com", "internal.example.com"]


def test_settings_enable_secure_auth_cookies_by_default(monkeypatch):
    _apply_env(monkeypatch, AUTH_COOKIE_SECURE=None)

    settings = Settings()

    assert settings.auth_cookie_secure is True


def test_settings_normalize_auth_cookie_samesite(monkeypatch):
    _apply_env(monkeypatch, AUTH_COOKIE_SAMESITE="Lax")

    settings = Settings()

    assert settings.auth_cookie_samesite == "lax"


def test_settings_default_db_pool_tuning(monkeypatch):
    _apply_env(
        monkeypatch,
        DB_POOL_SIZE=None,
        DB_MAX_OVERFLOW=None,
        DB_POOL_RECYCLE_SECONDS=None,
    )

    settings = Settings()

    assert settings.db_pool_size == 20
    assert settings.db_max_overflow == 20
    assert settings.db_pool_recycle_seconds == 300


def test_settings_require_redis_url_in_production(monkeypatch):
    _apply_env(monkeypatch, APP_ENV="production", REDIS_URL=None)

    with pytest.raises(ValidationError, match="REDIS_URL is required when APP_ENV=production"):
        Settings()


def test_get_settings_raises_runtime_error_for_short_jwt_secret(monkeypatch):
    _apply_env(monkeypatch, JWT_SECRET="too-short")
    _clear_settings_cache()

    with pytest.raises(RuntimeError, match="JWT_SECRET must be at least 32 characters long"):
        get_settings()

    _clear_settings_cache()


def test_get_settings_raises_runtime_error_for_short_device_api_secret(monkeypatch):
    _apply_env(monkeypatch, DEVICE_API_SECRET="too-short")
    _clear_settings_cache()

    with pytest.raises(RuntimeError, match="DEVICE_API_SECRET must be at least 32 characters long"):
        get_settings()

    _clear_settings_cache()


def test_get_settings_raises_runtime_error_for_default_database_credentials(monkeypatch):
    _apply_env(
        monkeypatch,
        DATABASE_URL="postgresql://user:password@db.example.com:5432/patient_db?sslmode=require",
    )
    _clear_settings_cache()

    with pytest.raises(RuntimeError, match="DATABASE_URL must not use default credentials 'user:password@'"):
        get_settings()

    _clear_settings_cache()
