from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import create_app
from app import middleware as app_middleware


def test_create_app_disables_docs_in_production(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("REDIS_URL", "redis://rate-limit-cache:6379/0")
    monkeypatch.delenv("API_DOCS_ENABLED", raising=False)
    get_settings.cache_clear()

    try:
        app = create_app()
        with TestClient(app) as client:
            response = client.get("/docs", headers={"host": "testserver"})
        assert response.status_code == 404
        assert app.openapi_url is None
    finally:
        get_settings.cache_clear()


def test_create_app_enforces_allowed_hosts(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("REDIS_URL", "redis://rate-limit-cache:6379/0")
    monkeypatch.setenv("ALLOWED_HOSTS", "api.example.com")
    get_settings.cache_clear()

    try:
        app = create_app()
        with TestClient(app) as client:
            allowed = client.get("/health", headers={"host": "api.example.com"})
            blocked = client.get("/health", headers={"host": "malicious.example.com"})

        assert allowed.status_code == 200
        assert blocked.status_code == 400
    finally:
        get_settings.cache_clear()


def test_create_app_sets_content_security_policy_header():
    app = create_app()

    with TestClient(app) as client:
        response = client.get("/health", headers={"host": "testserver"})

    assert response.status_code == 200
    assert response.headers["content-security-policy"].startswith("default-src 'self';")
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]


def test_ip_ban_cache_is_bounded_lru():
    app_middleware._ip_ban_cache.clear()

    max_entries = app_middleware._IP_BAN_CACHE_MAX_ENTRIES
    for index in range(max_entries):
        app_middleware._set_ip_ban_cache_entry(f"ip-{index}", float(index), float(index))

    app_middleware._get_ip_ban_cache_entry("ip-0", now=0.0)
    app_middleware._set_ip_ban_cache_entry("ip-overflow", 99_999.0, 99_999.0)

    assert len(app_middleware._ip_ban_cache) == max_entries
    assert "ip-0" in app_middleware._ip_ban_cache
    assert "ip-1" not in app_middleware._ip_ban_cache
    assert "ip-overflow" in app_middleware._ip_ban_cache

    app_middleware._ip_ban_cache.clear()
