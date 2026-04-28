import logging
import json
import sys
from types import ModuleType
from types import SimpleNamespace

from app.api import security as security_api
from app.core.logging_config import (
    RedactingJsonFormatter,
    get_request_id,
    redact_sensitive_data,
    reset_request_id,
    set_request_id,
)
from app.core.config import get_settings
from app.services import auth_privileges
from app.services import novu as novu_service
from app.services import redis_runtime as redis_runtime_service


def test_redact_sensitive_data_redacts_nested_sensitive_fields():
    payload = {
        "password": "secret-password",
        "headers": {
            "Authorization": "Bearer abc123",
        },
        "metadata": [
            {"token": "abc123"},
            {"safe": "value"},
        ],
    }

    redacted = redact_sensitive_data(payload)

    assert redacted["password"] == "[REDACTED]"
    assert redacted["headers"]["Authorization"] == "[REDACTED]"
    assert redacted["metadata"][0]["token"] == "[REDACTED]"
    assert redacted["metadata"][1]["safe"] == "value"


def test_redact_sensitive_data_redacts_extended_sensitive_markers():
    payload = {
        "email": "user@example.com",
        "phone_number": "0812345678",
        "session_cookie": "session-value",
        "apiKey": "secret-key",
    }

    redacted = redact_sensitive_data(payload)

    assert redacted["email"] == "[REDACTED]"
    assert redacted["phone_number"] == "[REDACTED]"
    assert redacted["session_cookie"] == "[REDACTED]"
    assert redacted["apiKey"] == "[REDACTED]"


def test_redacting_json_formatter_outputs_json_and_redacts_sensitive_fields():
    formatter = RedactingJsonFormatter()
    logger = logging.getLogger("test.logging")
    record = logger.makeRecord(
        name=logger.name,
        level=logging.INFO,
        fn=__file__,
        lno=1,
        msg="structured log",
        args=(),
        exc_info=None,
        extra={
            "password": "secret-password",
            "headers": {"Authorization": "Bearer abc123"},
            "safe": "ok",
        },
    )

    payload = json.loads(formatter.format(record))

    assert payload["message"] == "structured log"
    assert payload["password"] == "[REDACTED]"
    assert payload["headers"]["Authorization"] == "[REDACTED]"
    assert payload["safe"] == "ok"


def test_request_id_context_is_attached_to_log_records():
    logger = logging.getLogger("test.request-id")
    token = set_request_id("req-123")

    try:
        record = logger.makeRecord(
            name=logger.name,
            level=logging.INFO,
            fn=__file__,
            lno=1,
            msg="request scoped log",
            args=(),
            exc_info=None,
        )
    finally:
        reset_request_id(token)

    assert record.request_id == "req-123"
    assert get_request_id() is None


def test_redacting_json_formatter_redacts_email_in_structured_fields():
    formatter = RedactingJsonFormatter()
    logger = logging.getLogger("test.logging.redacted-email")
    record = logger.makeRecord(
        name=logger.name,
        level=logging.WARNING,
        fn=__file__,
        lno=1,
        msg="generic warning",
        args=(),
        exc_info=None,
        extra={
            "email": "user@example.com",
            "safe": "ok",
        },
    )

    payload = json.loads(formatter.format(record))

    assert payload["message"] == "generic warning"
    assert payload["email"] == "[REDACTED]"
    assert payload["safe"] == "ok"


def test_auth_privileges_missing_bootstrap_admin_logs_generic_message(db, monkeypatch, caplog):
    monkeypatch.setenv("SUPER_ADMIN_EMAILS", "missing-admin@example.com")
    get_settings.cache_clear()

    try:
        with caplog.at_level(logging.WARNING):
            created = auth_privileges.backfill_bootstrap_privileged_roles(db)
    finally:
        get_settings.cache_clear()

    assert created == 0
    assert len(caplog.records) == 1
    record = caplog.records[0]
    assert (
        record.getMessage()
        == "Bootstrap privileged-role backfill skipped configured SUPER_ADMIN_EMAIL because the admin account does not exist yet"
    )
    assert "missing-admin@example.com" not in caplog.text

    payload = json.loads(RedactingJsonFormatter().format(record))
    assert payload["email"] == "[REDACTED]"


def test_novu_init_failure_log_does_not_include_exception_message(monkeypatch, caplog):
    novu_service._novu_client = None
    monkeypatch.setenv("NOVU_ENABLED", "true")
    monkeypatch.setenv("NOVU_API_KEY", "novu_api_key_1234567890")
    get_settings.cache_clear()

    fake_novu = ModuleType("novu")
    fake_novu_api = ModuleType("novu.api")

    class BrokenEventApi:
        def __init__(self, **_kwargs):
            raise RuntimeError("token leak should not appear")

    fake_novu_api.EventApi = BrokenEventApi
    monkeypatch.setitem(sys.modules, "novu", fake_novu)
    monkeypatch.setitem(sys.modules, "novu.api", fake_novu_api)

    try:
        with caplog.at_level(logging.ERROR):
            client = novu_service.get_novu_client()
    finally:
        get_settings.cache_clear()
        novu_service._novu_client = None
        sys.modules.pop("novu.api", None)
        sys.modules.pop("novu", None)

    assert client is None
    assert len(caplog.records) == 1
    record = caplog.records[0]
    assert record.getMessage() == "Failed to initialize Novu client"
    assert "token leak should not appear" not in caplog.text
    assert getattr(record, "exception_type", None) == "RuntimeError"


def test_novu_send_failure_log_does_not_include_exception_message(monkeypatch, caplog):
    class BrokenClient:
        def trigger(self, _event):
            raise RuntimeError("secret token should not appear")

    fake_novu_dto = ModuleType("novu.dto")
    fake_novu_dto_event = ModuleType("novu.dto.event")

    class FakeInputEventDto:
        def __init__(self, **_kwargs):
            pass

    fake_novu_dto_event.InputEventDto = FakeInputEventDto
    monkeypatch.setitem(sys.modules, "novu.dto", fake_novu_dto)
    monkeypatch.setitem(sys.modules, "novu.dto.event", fake_novu_dto_event)
    monkeypatch.setattr(novu_service, "get_novu_client", lambda: BrokenClient())

    with caplog.at_level(logging.ERROR):
        result = novu_service.send_notification(
            subscriber_id="user-1",
            workflow_name="patient-events",
            payload={"event": "patient_created"},
        )

    assert result is False
    assert len(caplog.records) == 1
    record = caplog.records[0]
    assert record.getMessage() == "Failed to send notification"
    assert "secret token should not appear" not in caplog.text
    assert getattr(record, "exception_type", None) == "RuntimeError"


def test_security_monitoring_event_uses_structured_logging(caplog):
    actor = SimpleNamespace(id="actor-1")
    target = SimpleNamespace(id="target-1")

    with caplog.at_level(logging.INFO):
        security_api._emit_security_monitoring_event(
            action="admin_force_password_reset",
            status="success",
            actor=actor,
            target_user=target,
            ip_address="10.0.0.1",
            details={
                "reason_present": True,
                "target_email": "sensitive@example.com",
            },
        )

    assert len(caplog.records) == 1
    record = caplog.records[0]
    assert record.getMessage() == "security_audit_event"
    assert getattr(record, "event", None) == "security_audit_event"
    assert getattr(record, "security_action", None) == "admin_force_password_reset"
    assert getattr(record, "security_status", None) == "success"
    assert getattr(record, "actor_user_id", None) == "actor-1"
    assert getattr(record, "target_user_id", None) == "target-1"

    payload = json.loads(RedactingJsonFormatter().format(record))
    assert payload["message"] == "security_audit_event"
    assert payload["event"] == "security_audit_event"
    assert payload["security_action"] == "admin_force_password_reset"
    assert payload["details"]["reason_present"] is True
    assert payload["details"]["target_email"] == "[REDACTED]"


def test_redis_runtime_snapshot_event_uses_structured_logging(caplog, monkeypatch):
    redis_runtime_service.reset_runtime_diagnostics()
    monkeypatch.setattr(
        redis_runtime_service,
        "get_redis_client",
        lambda: (_ for _ in ()).throw(RuntimeError("redis unavailable")),
    )

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
        fallback_label="stateless processing",
    )

    with caplog.at_level(logging.INFO):
        emitted = redis_runtime_service.emit_runtime_diagnostics_event(logger)

    assert emitted is True
    snapshot_records = [
        record for record in caplog.records if record.getMessage() == "redis_runtime_snapshot"
    ]
    assert len(snapshot_records) == 1

    payload = json.loads(RedactingJsonFormatter().format(snapshot_records[0]))
    assert payload["event"] == "redis_runtime_snapshot"
    assert payload["redis_unavailable_scope_total"] == 1
    assert payload["redis_degraded_scope_count"] == 1
    assert payload["redis_operation_failure_total"] == 1
    assert payload["redis_unavailable_scopes"] == ["stats cache"]


def test_redis_runtime_alert_event_uses_structured_logging(caplog):
    logger = logging.getLogger("test")
    diagnostics = {
        "degraded_scope_count": 1,
        "operation_failure_total": 2,
    }
    alert = {
        "status": "critical",
        "should_alert": True,
        "reasons": ["degraded_scope_count=1 reached threshold 1"],
        "degraded_scope_threshold": 1,
        "operation_failure_threshold": 5,
    }

    with caplog.at_level(logging.WARNING):
        emitted = redis_runtime_service.emit_runtime_alert_event(
            logger,
            diagnostics=diagnostics,
            alert=alert,
        )

    assert emitted is True
    alert_records = [
        record for record in caplog.records if record.getMessage() == "redis_runtime_alert"
    ]
    assert len(alert_records) == 1

    payload = json.loads(RedactingJsonFormatter().format(alert_records[0]))
    assert payload["event"] == "redis_runtime_alert"
    assert payload["severity"] == "critical"
    assert payload["redis_degraded_scope_count"] == 1
    assert payload["redis_operation_failure_total"] == 2
