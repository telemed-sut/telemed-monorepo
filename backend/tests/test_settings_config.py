from app.core.config import Settings


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


def test_settings_accepts_json_device_api_secrets(monkeypatch):
    _apply_env(
        monkeypatch,
        DEVICE_API_SECRETS='{"device-json-001":"device_secret_json_1234567890abcdef1234567890"}',
    )

    settings = Settings()

    assert settings.device_api_secrets == {
        "device-json-001": "device_secret_json_1234567890abcdef1234567890"
    }


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
