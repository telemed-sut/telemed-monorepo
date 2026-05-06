from fastapi.testclient import TestClient

import app.middleware as app_middleware
from app.main import create_app


def _bypass_ip_ban_middleware(monkeypatch) -> None:
    monkeypatch.setattr(app_middleware.security_service, "is_ip_whitelisted", lambda ip: True)


def test_deep_health_check_reports_ok(monkeypatch):
    _bypass_ip_ban_middleware(monkeypatch)
    monkeypatch.setattr("app.main._run_database_healthcheck", lambda: "ok")

    app = create_app()

    with TestClient(app) as client:
        response = client.get("/health", headers={"host": "testserver"})

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "db": "ok",
    }
    assert response.headers["x-request-id"]


def test_deep_health_check_reports_degraded_when_database_fails(monkeypatch):
    _bypass_ip_ban_middleware(monkeypatch)
    monkeypatch.setattr(
        "app.main._run_database_healthcheck",
        lambda: (_ for _ in ()).throw(RuntimeError("db down")),
    )

    app = create_app()

    with TestClient(app) as client:
        response = client.get("/health", headers={"host": "testserver"})

    assert response.status_code == 503
    assert response.json() == {
        "status": "degraded",
        "db": "error",
    }
    assert response.headers["x-request-id"]


def test_live_health_check_stays_shallow(monkeypatch):
    _bypass_ip_ban_middleware(monkeypatch)
    monkeypatch.setattr(
        "app.main._run_database_healthcheck",
        lambda: (_ for _ in ()).throw(RuntimeError("should not run")),
    )

    app = create_app()

    with TestClient(app) as client:
        response = client.get("/health/live", headers={"host": "testserver"})

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_request_id_header_is_present_on_root_route(monkeypatch):
    _bypass_ip_ban_middleware(monkeypatch)
    app = create_app()

    with TestClient(app) as client:
        response = client.get("/", headers={"host": "testserver"})

    assert response.status_code == 200
    assert response.headers["x-request-id"]
