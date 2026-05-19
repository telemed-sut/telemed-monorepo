import json
import logging
import sys
from contextvars import ContextVar, Token
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
    "phone",
    "email",
    "pin",
    "cookie",
    "session",
    "api_key",
    "apikey",
)
_CONFIGURED_ENV: str | None = None
_RESERVED_LOG_RECORD_FIELDS = frozenset(logging.makeLogRecord({}).__dict__.keys())
_REQUEST_ID_CONTEXT: ContextVar[str | None] = ContextVar(
    "request_id",
    default=None,
)
_ORIGINAL_LOG_RECORD_FACTORY = logging.getLogRecordFactory()
_REQUEST_ID_FACTORY_CONFIGURED = False
_HEALTH_ACCESS_FILTER_CONFIGURED = False
_HEALTH_LOG_PATHS = ("/health", "/health/live")


class _HealthAccessLogFilter(logging.Filter):
    """Drop uvicorn access-log lines for noisy health-check endpoints."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) >= 3:
            request_line = args[2]
            if isinstance(request_line, str):
                for path in _HEALTH_LOG_PATHS:
                    if f" {path} " in request_line:
                        return False
        message = record.getMessage()
        for path in _HEALTH_LOG_PATHS:
            if f" {path} " in message:
                return False
        return True


def _configure_health_access_filter() -> None:
    global _HEALTH_ACCESS_FILTER_CONFIGURED
    if _HEALTH_ACCESS_FILTER_CONFIGURED:
        return
    access_logger = logging.getLogger("uvicorn.access")
    access_logger.addFilter(_HealthAccessLogFilter())
    _HEALTH_ACCESS_FILTER_CONFIGURED = True


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


def set_request_id(request_id: str | None) -> Token[str | None]:
    return _REQUEST_ID_CONTEXT.set(request_id)


def reset_request_id(token: Token[str | None]) -> None:
    _REQUEST_ID_CONTEXT.reset(token)


def get_request_id() -> str | None:
    return _REQUEST_ID_CONTEXT.get()


def _configure_request_id_log_record_factory() -> None:
    global _REQUEST_ID_FACTORY_CONFIGURED
    if _REQUEST_ID_FACTORY_CONFIGURED:
        return

    def record_factory(*args: Any, **kwargs: Any) -> logging.LogRecord:
        record = _ORIGINAL_LOG_RECORD_FACTORY(*args, **kwargs)
        if not getattr(record, "request_id", None):
            record.request_id = get_request_id()
        return record

    logging.setLogRecordFactory(record_factory)
    _REQUEST_ID_FACTORY_CONFIGURED = True


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
    _configure_request_id_log_record_factory()
    _configure_health_access_filter()

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


_configure_request_id_log_record_factory()
_configure_health_access_filter()
