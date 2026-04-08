from fastapi.testclient import TestClient

from app.main import create_app


def test_deep_health_check_reports_ok_without_redis(monkeypatch):
    monkeypatch.setattr("app.main._run_database_healthcheck", lambda: "ok")
    monkeypatch.setattr("app.main._run_redis_healthcheck", lambda settings: "disabled")

    app = create_app()

    with TestClient(app) as client:
        response = client.get("/health", headers={"host": "testserver"})

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db": "ok", "redis": "disabled"}
    assert response.headers["x-request-id"]


def test_deep_health_check_reports_degraded_when_database_fails(monkeypatch):
    monkeypatch.setattr(
        "app.main._run_database_healthcheck",
        lambda: (_ for _ in ()).throw(RuntimeError("db down")),
    )
    monkeypatch.setattr("app.main._run_redis_healthcheck", lambda settings: "ok")

    app = create_app()

    with TestClient(app) as client:
        response = client.get("/health", headers={"host": "testserver"})

    assert response.status_code == 503
    assert response.json() == {"status": "degraded", "db": "error", "redis": "ok"}
    assert response.headers["x-request-id"]


def test_live_health_check_stays_shallow(monkeypatch):
    monkeypatch.setattr(
        "app.main._run_database_healthcheck",
        lambda: (_ for _ in ()).throw(RuntimeError("should not run")),
    )
    monkeypatch.setattr(
        "app.main._run_redis_healthcheck",
        lambda settings: (_ for _ in ()).throw(RuntimeError("should not run")),
    )

    app = create_app()

    with TestClient(app) as client:
        response = client.get("/health/live", headers={"host": "testserver"})

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_request_id_header_is_present_on_root_route():
    app = create_app()

    with TestClient(app) as client:
        response = client.get("/", headers={"host": "testserver"})

    assert response.status_code == 200
    assert response.headers["x-request-id"]
