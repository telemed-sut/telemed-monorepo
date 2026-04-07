import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any

try:
    from pythonjsonlogger.json import JsonFormatter as BaseJsonFormatter
except ImportError:  # pragma: no cover - dependency is installed in CI/runtime
    BaseJsonFormatter = logging.Formatter


REDACTED_VALUE = "[REDACTED]"
SENSITIVE_FIELD_MARKERS = (
    "authorization",
    "password",
    "secret",
    "token",
)
_CONFIGURED_ENV: str | None = None
_RESERVED_LOG_RECORD_FIELDS = frozenset(logging.makeLogRecord({}).__dict__.keys())


def _is_sensitive_field(field_name: str) -> bool:
    normalized = (field_name or "").strip().lower().replace("-", "_")
    return any(marker in normalized for marker in SENSITIVE_FIELD_MARKERS)


def redact_sensitive_data(value: Any, field_name: str | None = None) -> Any:
    if field_name and _is_sensitive_field(field_name):
        return REDACTED_VALUE

    if isinstance(value, dict):
        return {
            key: redact_sensitive_data(item, str(key))
            for key, item in value.items()
        }

    if isinstance(value, list):
        return [redact_sensitive_data(item, field_name) for item in value]

    if isinstance(value, tuple):
        return tuple(redact_sensitive_data(item, field_name) for item in value)

    return value


class RedactingJsonFormatter(BaseJsonFormatter):
    def process_log_record(self, log_data: dict[str, Any]) -> dict[str, Any]:
        processor = getattr(super(), "process_log_record", None)
        if callable(processor):
            log_data = processor(log_data)
        return redact_sensitive_data(log_data)

    def add_fields(self, log_record: dict[str, Any], record: logging.LogRecord, message_dict: dict[str, Any]) -> None:
        add_fields = getattr(super(), "add_fields", None)
        if callable(add_fields):
            add_fields(log_record, record, message_dict)
        else:  # pragma: no cover - fallback when python-json-logger is unavailable
            log_record.update(message_dict)
            log_record.setdefault("message", record.getMessage())

        log_record.setdefault("timestamp", datetime.fromtimestamp(record.created, UTC).isoformat())
        log_record.setdefault("level", record.levelname)
        log_record.setdefault("logger", record.name)

    def format(self, record: logging.LogRecord) -> str:
        if BaseJsonFormatter is logging.Formatter:
            payload = {
                "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(),
                "level": record.levelname,
                "logger": record.name,
                "message": record.getMessage(),
            }
            for key, value in record.__dict__.items():
                if key not in _RESERVED_LOG_RECORD_FIELDS:
                    payload[key] = redact_sensitive_data(value, key)
            return json.dumps(payload, default=str)
        return super().format(record)


def configure_logging(app_env: str) -> None:
    global _CONFIGURED_ENV
    normalized_env = (app_env or "").strip().lower()
    if normalized_env != "production":
        return
    if _CONFIGURED_ENV == normalized_env:
        return

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(RedactingJsonFormatter())

    root_logger = logging.getLogger()
    root_logger.handlers = [handler]
    root_logger.setLevel(logging.INFO)

    for logger_name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        app_logger = logging.getLogger(logger_name)
        app_logger.handlers = [handler]
        app_logger.setLevel(logging.INFO)
        app_logger.propagate = False

    _CONFIGURED_ENV = normalized_env
