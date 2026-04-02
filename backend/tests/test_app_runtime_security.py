from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import create_app


def test_create_app_disables_docs_in_production(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
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
