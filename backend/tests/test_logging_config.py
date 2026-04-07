import json
import logging

from app.core.logging_config import RedactingJsonFormatter, redact_sensitive_data


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
