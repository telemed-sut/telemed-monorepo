import logging
import json

from app.core.logging_config import (
    RedactingJsonFormatter,
    get_request_id,
    redact_sensitive_data,
    reset_request_id,
    set_request_id,
)


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
