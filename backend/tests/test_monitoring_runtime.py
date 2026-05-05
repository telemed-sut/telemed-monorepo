import logging

from fastapi.testclient import TestClient

import app.middleware as app_middleware
import app.main as app_main
from app.main import create_app
from app.services import redis_runtime as redis_runtime_service


def _bypass_ip_ban_middleware(monkeypatch) -> None:
    monkeypatch.setattr(app_middleware.security_service, "is_ip_whitelisted", lambda ip: True)


def test_deep_health_check_reports_ok_without_redis(monkeypatch):
    redis_runtime_service.reset_runtime_diagnostics()
    _bypass_ip_ban_middleware(monkeypatch)
    monkeypatch.setattr("app.main._run_database_healthcheck", lambda: "ok")

    app = create_app()

    with TestClient(app) as client:
        response = client.get("/health", headers={"host": "testserver"})

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "db": "ok",
        "redis": "disabled",
        "redis_runtime": {
            "unavailable_scopes": [],
            "unavailable_scope_counts": {},
            "unavailable_scope_total": 0,
            "degraded_scope_count": 0,
            "last_unavailable_at": None,
            "operation_failures": {},
            "operation_failure_total": 0,
            "last_operation_failure_at": None,
        },
        "redis_runtime_alert": {
            "status": "ok",
            "should_alert": False,
            "reasons": [],
            "degraded_scope_threshold": 1,
            "operation_failure_threshold": 5,
        },
    }
    assert response.headers["x-request-id"]


def test_deep_health_check_reports_degraded_when_database_fails(monkeypatch):
    redis_runtime_service.reset_runtime_diagnostics()
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
        "redis": "disabled",
        "redis_runtime": {
            "unavailable_scopes": [],
            "unavailable_scope_counts": {},
            "unavailable_scope_total": 0,
            "degraded_scope_count": 0,
            "last_unavailable_at": None,
            "operation_failures": {},
            "operation_failure_total": 0,
            "last_operation_failure_at": None,
        },
        "redis_runtime_alert": {
            "status": "ok",
            "should_alert": False,
            "reasons": [],
            "degraded_scope_threshold": 1,
            "operation_failure_threshold": 5,
        },
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


def test_health_check_exposes_redis_runtime_diagnostics(monkeypatch):
    redis_runtime_service.reset_runtime_diagnostics()
    _bypass_ip_ban_middleware(monkeypatch)
    monkeypatch.setattr("app.main._run_database_healthcheck", lambda: "ok")

    logger = logging.getLogger("test")
    redis_runtime_service.get_redis_client_or_log(
        logger,
        scope="stats cache",
        fallback_label="database query",
    )
    redis_runtime_service.log_redis_operation_failure(
        logger,
        scope="idempotency cache",
        operation="write",
        fallback_label="stateless request processing",
    )

    app = create_app()

    with TestClient(app) as client:
        response = client.get("/health", headers={"host": "testserver"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["redis_runtime"]["unavailable_scopes"] == ["stats cache"]
    assert payload["redis_runtime"]["unavailable_scope_counts"] == {"stats cache": 1}
    assert payload["redis_runtime"]["unavailable_scope_total"] == 1
    assert payload["redis_runtime"]["degraded_scope_count"] == 1
    assert payload["redis_runtime"]["last_unavailable_at"]
    assert payload["redis_runtime"]["operation_failures"] == {"idempotency cache:write": 1}
    assert payload["redis_runtime"]["operation_failure_total"] == 1
    assert payload["redis_runtime"]["last_operation_failure_at"]
    assert payload["redis_runtime_alert"] == {
        "status": "critical",
        "should_alert": True,
        "reasons": ["degraded_scope_count=1 reached threshold 1"],
        "degraded_scope_threshold": 1,
        "operation_failure_threshold": 5,
    }


def test_emit_runtime_diagnostics_event_logs_structured_snapshot_once(monkeypatch, caplog):
    redis_runtime_service.reset_runtime_diagnostics()

    logger = logging.getLogger("test")
    redis_runtime_service.get_redis_client_or_log(
        logger,
        scope="stats cache",
        fallback_label="database query",
    )
    redis_runtime_service.log_redis_operation_failure(
        logger,
        scope="idempotency cache",
        operation="write",
        fallback_label="stateless request processing",
    )

    with caplog.at_level(logging.INFO):
        first_emit = redis_runtime_service.emit_runtime_diagnostics_event(logger)
        second_emit = redis_runtime_service.emit_runtime_diagnostics_event(logger)

    assert first_emit is True
    assert second_emit is False

    snapshot_records = [
        record for record in caplog.records if record.getMessage() == "redis_runtime_snapshot"
    ]
    assert len(snapshot_records) == 1
    record = snapshot_records[0]
    assert getattr(record, "event", None) == "redis_runtime_snapshot"
    assert getattr(record, "redis_unavailable_scope_total", None) == 1
    assert getattr(record, "redis_degraded_scope_count", None) == 1
    assert getattr(record, "redis_operation_failure_total", None) == 1


def test_health_check_raises_warning_alert_for_operation_failure_threshold(monkeypatch):
    redis_runtime_service.reset_runtime_diagnostics()
    _bypass_ip_ban_middleware(monkeypatch)
    monkeypatch.setattr("app.main._run_database_healthcheck", lambda: "ok")
    settings = app_main.get_settings()
    monkeypatch.setattr(settings, "redis_runtime_degraded_scope_alert_threshold", 10)
    monkeypatch.setattr(settings, "redis_runtime_operation_failure_alert_threshold", 1)

    logger = logging.getLogger("test")
    redis_runtime_service.log_redis_operation_failure(
        logger,
        scope="idempotency cache",
        operation="write",
        fallback_label="stateless request processing",
    )

    app = create_app()

    with TestClient(app) as client:
        response = client.get("/health", headers={"host": "testserver"})

    assert response.status_code == 200
    assert response.json()["redis_runtime_alert"] == {
        "status": "warning",
        "should_alert": True,
        "reasons": ["operation_failure_total=1 reached threshold 1"],
        "degraded_scope_threshold": 10,
        "operation_failure_threshold": 1,
    }
