"""Regression tests for rate-limiter key derivation security.

P1 fix: The limiter must not decode unverified JWT payloads to derive
rate-limit keys. Forged tokens with arbitrary `sub` values would bypass
the shared bucket. The fix hashes the raw bearer token instead.

Run with: PYTHONPATH=. .venv/bin/pytest tests/test_rate_limiter_key_security.py
"""

import pytest

from app.core.config import get_settings

BASELINE_ENV = {
    "DATABASE_URL": "sqlite:///:memory:",
    "JWT_SECRET": "jwt_secret_1234567890abcdef1234567890",
    "JWT_EXPIRES_IN": "3600",
    "DEVICE_API_SECRET": "device_secret_1234567890abcdef1234567890",
    "DEVICE_API_REQUIRE_REGISTERED_DEVICE": "false",
    "APP_ENV": "test",
    "REDIS_URL": None,
}


def _apply_env(monkeypatch, **overrides) -> None:
    for key, value in BASELINE_ENV.items():
        monkeypatch.setenv(key, value)
    for key, value in overrides.items():
        if value is None:
            monkeypatch.delenv(key, raising=False)
            continue
        monkeypatch.setenv(key, value)


@pytest.fixture(autouse=True)
def setup_env(monkeypatch):
    _apply_env(monkeypatch)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _make_bearer(sub: str) -> str:
    """Construct a syntactically valid but fake JWT with the given sub."""
    import base64
    import json

    header = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(json.dumps({"sub": sub}).encode()).rstrip(b"=").decode()
    signature = base64.urlsafe_b64encode(b"fake_signature").rstrip(b"=").decode()
    return f"{header}.{payload}.{signature}"


class TestBearerRateLimitKeySecurity:
    """Ensure forged tokens cannot bypass per-token rate limiting."""

    def test_missing_bearer_falls_back_to_ip(self, monkeypatch):
        from app.core.limiter import _get_bearer_rate_limit_key
        key = _get_bearer_rate_limit_key("Bearer ", "1.2.3.4")
        assert key == "ip:1.2.3.4"

    def test_valid_bearer_uses_token_hash_not_sub(self, monkeypatch):
        """Different subs must produce the same key if the raw token is identical."""
        from app.core.limiter import _get_bearer_rate_limit_key
        token = _make_bearer("user-alice")
        auth = f"Bearer {token}"
        key = _get_bearer_rate_limit_key(auth, "1.2.3.4")

        assert key.startswith("tok:")
        assert "alice" not in key

    def test_different_tokens_produce_different_keys(self, monkeypatch):
        """Two distinct tokens must map to distinct buckets."""
        from app.core.limiter import _get_bearer_rate_limit_key
        token_a = _make_bearer("user-alice")
        token_b = _make_bearer("user-bob")

        key_a = _get_bearer_rate_limit_key(f"Bearer {token_a}", "1.2.3.4")
        key_b = _get_bearer_rate_limit_key(f"Bearer {token_b}", "1.2.3.4")

        assert key_a != key_b

    def test_same_token_always_same_key(self, monkeypatch):
        """The same token must always produce the same key (deterministic hashing)."""
        from app.core.limiter import _get_bearer_rate_limit_key
        token = _make_bearer("user-charlie")
        auth = f"Bearer {token}"

        key_1 = _get_bearer_rate_limit_key(auth, "1.2.3.4")
        key_2 = _get_bearer_rate_limit_key(auth, "5.6.7.8")

        assert key_1 == key_2

    def test_malformed_token_falls_back_gracefully(self, monkeypatch):
        """Malformed tokens should not crash — hash the raw string safely."""
        from app.core.limiter import _get_bearer_rate_limit_key
        key = _get_bearer_rate_limit_key("Bearer not-a-valid-jwt-at-all", "10.0.0.1")
        # We hash the raw string — safe and intentional
        assert key.startswith("tok:")

    def test_no_bearer_header_uses_ip(self, monkeypatch):
        from app.core.limiter import _get_bearer_rate_limit_key
        key = _get_bearer_rate_limit_key("", "1.2.3.4")
        assert key == "ip:1.2.3.4"
