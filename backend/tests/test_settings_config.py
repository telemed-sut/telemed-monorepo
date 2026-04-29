from pathlib import Path

import pytest
from pydantic import ValidationError

import app.core.secret_crypto as secret_crypto
from app.core.config import Settings, get_settings
from tests.conftest import _load_enforced_test_environment


BASELINE_ENV = {
    "DATABASE_URL": "sqlite:///:memory:",
    "JWT_SECRET": "jwt_secret_1234567890abcdef1234567890",
    "JWT_EXPIRES_IN": "3600",
    "DEVICE_API_SECRET": "device_secret_1234567890abcdef1234567890",
    "DEVICE_API_REQUIRE_REGISTERED_DEVICE": "false",
    "DEVICE_API_REQUIRE_BODY_HASH_SIGNATURE": "false",
    "DEVICE_API_REQUIRE_NONCE": "false",
    "DEVICE_SECRET_ENCRYPTION_KEY": "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    "ALLOW_INSECURE_SECRET_STORAGE": "false",
    "MEETING_SIGNING_SECRET": "meeting_signing_secret_1234567890abcdef1234567890",
}

ISOLATED_ENV_KEYS = {
    *BASELINE_ENV.keys(),
    "ALLOWED_HOSTS",
    "API_DOCS_ENABLED",
    "APP_ENV",
    "AUTH_COOKIE_SECURE",
    "DB_POOL_SIZE",
    "DB_MAX_OVERFLOW",
    "DB_POOL_RECYCLE_SECONDS",
    "DEVICE_API_SECRETS",
    "DEVICE_SECRET_ENCRYPTION_KEY",
    "ALLOW_INSECURE_SECRET_STORAGE",
    "MEETING_SIGNING_ALLOW_JWT_SECRET_FALLBACK",
    "REDIS_URL",
    "ADMIN_OIDC_ENABLED",
    "ADMIN_OIDC_ISSUER_URL",
    "ADMIN_OIDC_CLIENT_ID",
    "ADMIN_OIDC_CLIENT_SECRET",
    "ADMIN_OIDC_REDIRECT_URI",
    "ADMIN_OIDC_POST_LOGOUT_REDIRECT_URI",
}


def _apply_env(monkeypatch, **overrides) -> None:
    for key in ISOLATED_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)

    for key, value in BASELINE_ENV.items():
        monkeypatch.setenv(key, value)

    for key, value in overrides.items():
        if value is None:
            monkeypatch.delenv(key, raising=False)
            continue
        monkeypatch.setenv(key, value)


def _clear_settings_cache() -> None:
    get_settings.cache_clear()


def _build_settings() -> Settings:
    return Settings(_env_file=None)


def test_settings_accepts_json_device_api_secrets(monkeypatch):
    _apply_env(
        monkeypatch,
        DEVICE_API_SECRETS='{"device-json-001":"device_secret_json_1234567890abcdef1234567890"}',
    )

    settings = _build_settings()

    assert settings.device_api_secrets == {
        "device-json-001": "device_secret_json_1234567890abcdef1234567890"
    }


def test_test_env_bootstrap_overrides_sensitive_local_env_values():
    env_path = Path(__file__).resolve().parents[1] / ".env.test"
    environ = {
        "APP_ENV": "production",
        "PRIVILEGED_ACTION_MFA_MAX_AGE_SECONDS": "14400",
        "ADMIN_JWT_EXPIRES_IN": "43200",
    }

    _load_enforced_test_environment(env_path=env_path, environ=environ)

    assert environ["APP_ENV"] == "test"
    assert environ["PRIVILEGED_ACTION_MFA_MAX_AGE_SECONDS"] == "900"
    assert environ["ADMIN_JWT_EXPIRES_IN"] == "14400"


def test_test_env_bootstrap_fails_closed_when_required_security_key_is_missing(tmp_path):
    env_path = tmp_path / ".env.test"
    env_path.write_text(
        "\n".join(
            [
                "JWT_SECRET=test_secret_minimum_32_characters_long",
                "JWT_EXPIRES_IN=3600",
                "PASSWORD_RESET_EXPIRES_IN=900",
                "DEVICE_SECRET_ENCRYPTION_KEY=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
                "ALLOW_INSECURE_SECRET_STORAGE=false",
                "MEETING_SIGNING_SECRET=test_meeting_signing_secret_minimum_32_characters",
                "DEVICE_API_SECRET=test_device_secret_minimum_32_characters",
                "DEVICE_API_REQUIRE_REGISTERED_DEVICE=false",
                "DEVICE_API_REQUIRE_BODY_HASH_SIGNATURE=false",
                "DEVICE_API_REQUIRE_NONCE=false",
                "AUTH_COOKIE_SECURE=false",
                "ADMIN_JWT_EXPIRES_IN=14400",
                "SUPER_ADMIN_EMAILS=admin@example.com",
                "TRUSTED_PROXY_IPS=127.0.0.1,::1",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    with pytest.raises(
        RuntimeError,
        match=r"\.env\.test is missing required security test settings: PRIVILEGED_ACTION_MFA_MAX_AGE_SECONDS",
    ):
        _load_enforced_test_environment(env_path=env_path, environ={})


def test_settings_normalizes_postgresql_database_url_to_psycopg(monkeypatch):
    _apply_env(
        monkeypatch,
        DATABASE_URL="postgresql://user:password@localhost:5432/patient_db",
    )

    settings = _build_settings()

    assert settings.database_url == "postgresql+psycopg://user:password@localhost:5432/patient_db"


def test_settings_normalizes_postgres_alias_database_url_to_psycopg(monkeypatch):
    _apply_env(
        monkeypatch,
        DATABASE_URL="postgres://user:password@localhost:5432/patient_db",
    )

    settings = _build_settings()

    assert settings.database_url == "postgresql+psycopg://user:password@localhost:5432/patient_db"


def test_settings_preserves_explicit_database_driver(monkeypatch):
    _apply_env(
        monkeypatch,
        DATABASE_URL="postgresql+psycopg://user:password@localhost:5432/patient_db",
    )

    settings = _build_settings()

    assert settings.database_url == "postgresql+psycopg://user:password@localhost:5432/patient_db"


def test_settings_accepts_comma_separated_device_api_secrets(monkeypatch):
    _apply_env(
        monkeypatch,
        DEVICE_API_SECRETS=(
            "device-a=device_secret_a_1234567890abcdef1234567890,"
            "device-b=device_secret_b_1234567890abcdef1234567890"
        ),
    )

    settings = _build_settings()

    assert settings.device_api_secrets == {
        "device-a": "device_secret_a_1234567890abcdef1234567890",
        "device-b": "device_secret_b_1234567890abcdef1234567890",
    }


def test_settings_allows_empty_azure_blob_storage_path_prefix(monkeypatch):
    _apply_env(
        monkeypatch,
        AZURE_BLOB_STORAGE_CONNECTION_STRING=(
            "DefaultEndpointsProtocol=https;"
            "AccountName=telemedheartsound01;"
            "AccountKey=test-key;"
            "EndpointSuffix=core.windows.net"
        ),
        AZURE_BLOB_STORAGE_CONTAINER="heart-sounds",
        AZURE_BLOB_STORAGE_PATH_PREFIX="",
    )

    settings = _build_settings()

    assert settings.azure_blob_storage_path_prefix == ""


def test_settings_enable_api_docs_by_default_in_development(monkeypatch):
    _apply_env(monkeypatch, APP_ENV="development", API_DOCS_ENABLED=None)

    settings = _build_settings()

    assert settings.should_enable_api_docs is True


def test_settings_disable_api_docs_by_default_in_production(monkeypatch):
    _apply_env(
        monkeypatch,
        APP_ENV="production",
        API_DOCS_ENABLED=None,
        REDIS_URL="redis://rate-limit-cache:6379/0",
        DEVICE_API_REQUIRE_REGISTERED_DEVICE="true",
        DEVICE_API_REQUIRE_BODY_HASH_SIGNATURE="true",
        DEVICE_API_REQUIRE_NONCE="true",
    )

    settings = _build_settings()

    assert settings.should_enable_api_docs is False


def test_settings_resolve_allowed_hosts_for_local_environments(monkeypatch):
    _apply_env(monkeypatch, APP_ENV="test", ALLOWED_HOSTS=None)

    settings = _build_settings()

    assert settings.resolved_allowed_hosts == [
        "localhost",
        "127.0.0.1",
        "::1",
        "testserver",
        "backend",
        "patient-backend",
        "frontend",
        "patient-frontend",
    ]


def test_settings_accept_explicit_allowed_hosts(monkeypatch):
    _apply_env(monkeypatch, ALLOWED_HOSTS="api.example.com,internal.example.com")

    settings = _build_settings()

    assert settings.resolved_allowed_hosts == [
        "api.example.com",
        "internal.example.com",
        "localhost",
        "127.0.0.1",
        "::1",
        "testserver",
        "backend",
        "patient-backend",
        "frontend",
        "patient-frontend",
    ]


def test_settings_enable_secure_auth_cookies_by_default(monkeypatch):
    _apply_env(monkeypatch, AUTH_COOKIE_SECURE=None)

    settings = _build_settings()

    assert settings.auth_cookie_secure is True


def test_settings_normalize_auth_cookie_samesite(monkeypatch):
    _apply_env(monkeypatch, AUTH_COOKIE_SAMESITE="Lax")

    settings = _build_settings()

    assert settings.auth_cookie_samesite == "lax"


def test_settings_default_db_pool_tuning(monkeypatch):
    _apply_env(
        monkeypatch,
        DB_POOL_SIZE=None,
        DB_MAX_OVERFLOW=None,
        DB_POOL_RECYCLE_SECONDS=None,
    )

    settings = _build_settings()

    assert settings.db_pool_size == 20
    assert settings.db_max_overflow == 20
    assert settings.db_pool_recycle_seconds == 300


def test_settings_require_redis_url_in_production(monkeypatch):
    _apply_env(
        monkeypatch,
        APP_ENV="production",
        REDIS_URL=None,
        DEVICE_API_REQUIRE_REGISTERED_DEVICE="true",
        DEVICE_API_REQUIRE_BODY_HASH_SIGNATURE="true",
        DEVICE_API_REQUIRE_NONCE="true",
    )

    with pytest.raises(ValidationError, match="REDIS_URL is required when APP_ENV=production"):
        _build_settings()


def test_settings_require_strict_device_ingest_flags_in_production(monkeypatch):
    _apply_env(
        monkeypatch,
        APP_ENV="production",
        REDIS_URL="redis://rate-limit-cache:6379/0",
        DEVICE_API_REQUIRE_REGISTERED_DEVICE="true",
        DEVICE_API_REQUIRE_BODY_HASH_SIGNATURE="false",
        DEVICE_API_REQUIRE_NONCE="true",
    )

    with pytest.raises(
        ValidationError,
        match="Production device ingest hardening requires DEVICE_API_REQUIRE_BODY_HASH_SIGNATURE=true",
    ):
        _build_settings()


def test_settings_require_meeting_signing_secret_in_production(monkeypatch):
    _apply_env(
        monkeypatch,
        APP_ENV="production",
        REDIS_URL="redis://rate-limit-cache:6379/0",
        DEVICE_API_REQUIRE_REGISTERED_DEVICE="true",
        DEVICE_API_REQUIRE_BODY_HASH_SIGNATURE="true",
        DEVICE_API_REQUIRE_NONCE="true",
        MEETING_SIGNING_SECRET=None,
    )

    with pytest.raises(ValidationError, match="MEETING_SIGNING_SECRET is required when APP_ENV=production"):
        _build_settings()


def test_settings_allow_explicit_meeting_signing_fallback_in_non_production(monkeypatch):
    _apply_env(
        monkeypatch,
        APP_ENV="test",
        MEETING_SIGNING_SECRET=None,
        MEETING_SIGNING_ALLOW_JWT_SECRET_FALLBACK="true",
    )

    settings = _build_settings()

    assert settings.meeting_signing_secret is None
    assert settings.meeting_signing_allow_jwt_secret_fallback is True


def test_settings_require_secret_encryption_keys_in_production(monkeypatch):
    _apply_env(
        monkeypatch,
        APP_ENV="production",
        REDIS_URL="redis://rate-limit-cache:6379/0",
        DEVICE_API_REQUIRE_REGISTERED_DEVICE="true",
        DEVICE_API_REQUIRE_BODY_HASH_SIGNATURE="true",
        DEVICE_API_REQUIRE_NONCE="true",
        DEVICE_SECRET_ENCRYPTION_KEY=None,
    )

    with pytest.raises(
        ValidationError,
        match="Production secret-at-rest hardening requires DEVICE_SECRET_ENCRYPTION_KEY",
    ):
        _build_settings()


def test_settings_allow_explicit_insecure_secret_storage_only_in_non_production(monkeypatch):
    _apply_env(
        monkeypatch,
        APP_ENV="test",
        DEVICE_SECRET_ENCRYPTION_KEY=None,
        ALLOW_INSECURE_SECRET_STORAGE="true",
    )

    settings = _build_settings()

    assert settings.allow_insecure_secret_storage is True


def test_settings_default_to_insecure_secret_storage_in_development_when_keys_are_missing(monkeypatch):
    _apply_env(
        monkeypatch,
        APP_ENV="development",
        DEVICE_SECRET_ENCRYPTION_KEY=None,
        ALLOW_INSECURE_SECRET_STORAGE=None,
    )

    settings = _build_settings()

    assert settings.allow_insecure_secret_storage is True


def test_settings_still_fail_when_insecure_secret_storage_is_explicitly_disabled(monkeypatch):
    _apply_env(
        monkeypatch,
        APP_ENV="development",
        DEVICE_SECRET_ENCRYPTION_KEY=None,
        ALLOW_INSECURE_SECRET_STORAGE="false",
    )

    with pytest.raises(
        ValidationError,
        match="Secret-at-rest encryption keys are required unless",
    ):
        _build_settings()


def test_settings_fail_fast_when_crypto_backend_missing_for_encrypted_secret_storage(monkeypatch):
    _apply_env(monkeypatch, APP_ENV="test")
    monkeypatch.setattr(secret_crypto, "AES", None)
    monkeypatch.setattr(secret_crypto, "get_random_bytes", None)

    with pytest.raises(
        ValidationError,
        match="Missing dependency 'pycryptodomex'",
    ):
        _build_settings()


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
