from types import SimpleNamespace

from fastapi.testclient import TestClient

from app import main as app_main


def test_log_startup_metadata_includes_version_environment_and_pid(monkeypatch):
    captured = {}

    monkeypatch.setenv("APP_VERSION", "2026.04.08")
    monkeypatch.setattr(app_main.os, "getpid", lambda: 4321)
    monkeypatch.setattr(
        app_main.logger,
        "info",
        lambda message, extra=None: captured.update(
            {
                "message": message,
                "extra": extra,
            }
        ),
    )

    settings = SimpleNamespace(
        app_name="Patient Management API",
        app_env="production",
    )

    app_main._log_startup_metadata(settings)

    assert captured == {
        "message": "Application startup",
        "extra": {
            "app_name": "Patient Management API",
            "environment": "production",
            "version": "2026.04.08",
            "pid": 4321,
        },
    }


def test_application_lifespan_runs_startup_and_shutdown_hooks(monkeypatch):
    events: list[str] = []

    monkeypatch.setattr(app_main, "backfill_bootstrap_privileged_roles_on_startup", lambda: events.append("backfill"))
    monkeypatch.setattr(app_main, "_log_startup_metadata", lambda settings: events.append(f"log:{settings.app_env}"))
    monkeypatch.setattr(
        app_main.meeting_presence_service,
        "start_reconcile_worker",
        lambda: events.append("start-worker"),
    )
    monkeypatch.setattr(
        app_main.meeting_presence_service,
        "stop_reconcile_worker",
        lambda: events.append("stop-worker"),
    )

    app = app_main.create_app()

    with TestClient(app):
        assert events == ["backfill", "log:test", "start-worker"]

    assert events == ["backfill", "log:test", "start-worker", "stop-worker"]
