"""Shared Redis runtime helpers for optional cache-backed services."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from threading import Lock
from typing import Any, NoReturn

from app.db.session import get_redis_client

_warned_unavailable_scopes: set[str] = set()
_runtime_lock = Lock()
_unavailable_scope_counts: dict[str, int] = {}
_operation_failure_counts: dict[str, int] = {}
_last_unavailable_at: datetime | None = None
_last_operation_failure_at: datetime | None = None
_last_emitted_snapshot: dict[str, Any] | None = None
_last_emitted_alert_snapshot: dict[str, Any] | None = None


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _serialize_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(timezone.utc).isoformat()


def decode_cached_value(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bytes):
        return value.decode("utf-8")
    return str(value)


def parse_cached_datetime(value: Any) -> datetime | None:
    normalized = decode_cached_value(value)
    if not normalized:
        return None
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def get_redis_client_or_log(
    logger: logging.Logger,
    *,
    scope: str,
    fallback_label: str,
):
    try:
        return get_redis_client()
    except Exception:
        now = _utc_now()
        with _runtime_lock:
            _unavailable_scope_counts[scope] = _unavailable_scope_counts.get(scope, 0) + 1
            global _last_unavailable_at
            _last_unavailable_at = now
            first_warning_for_scope = scope not in _warned_unavailable_scopes
            if first_warning_for_scope:
                _warned_unavailable_scopes.add(scope)

        if first_warning_for_scope:
            logger.warning(
                "%s unavailable; falling back to %s.",
                scope,
                fallback_label,
                exc_info=True,
                extra={
                    "event": "redis_runtime_unavailable",
                    "redis_scope": scope,
                    "fallback": fallback_label,
                },
            )
        else:
            logger.debug(
                "%s still unavailable; continuing with %s fallback.",
                scope,
                fallback_label,
                exc_info=True,
            )
        return None


def log_redis_operation_failure(
    logger: logging.Logger,
    *,
    scope: str,
    operation: str,
    fallback_label: str,
) -> None:
    failure_key = f"{scope}:{operation}"
    with _runtime_lock:
        _operation_failure_counts[failure_key] = _operation_failure_counts.get(failure_key, 0) + 1
        global _last_operation_failure_at
        _last_operation_failure_at = _utc_now()

    logger.warning(
        "Redis %s failed for %s; continuing with %s fallback.",
        operation,
        scope,
        fallback_label,
        exc_info=True,
        extra={
            "event": "redis_runtime_operation_failed",
            "redis_scope": scope,
            "redis_operation": operation,
            "fallback": fallback_label,
        },
    )


def allows_local_runtime_fallback(app_env: str) -> bool:
    return (app_env or "").strip().lower() in {"development", "test"}


def raise_redis_runtime_required(
    logger: logging.Logger,
    *,
    scope: str,
    app_env: str,
) -> NoReturn:
    normalized_env = (app_env or "").strip().lower() or "unknown"
    logger.error(
        "%s requires Redis-backed shared runtime state in %s.",
        scope,
        normalized_env,
        extra={
            "event": "redis_runtime_required",
            "redis_scope": scope,
            "app_env": normalized_env,
        },
    )
    raise RuntimeError(
        f"{scope} requires Redis-backed shared runtime state in {normalized_env}."
    )


def get_runtime_diagnostics() -> dict[str, Any]:
    with _runtime_lock:
        unavailable_scopes = sorted(_unavailable_scope_counts.keys())
        unavailable_scope_counts = dict(sorted(_unavailable_scope_counts.items()))
        operation_failures = dict(sorted(_operation_failure_counts.items()))
        return {
            "unavailable_scopes": unavailable_scopes,
            "unavailable_scope_counts": unavailable_scope_counts,
            "unavailable_scope_total": sum(unavailable_scope_counts.values()),
            "degraded_scope_count": len(unavailable_scopes),
            "last_unavailable_at": _serialize_datetime(_last_unavailable_at),
            "operation_failures": operation_failures,
            "operation_failure_total": sum(operation_failures.values()),
            "last_operation_failure_at": _serialize_datetime(_last_operation_failure_at),
        }


def emit_runtime_diagnostics_event(logger: logging.Logger) -> bool:
    diagnostics = get_runtime_diagnostics()
    if (
        diagnostics["degraded_scope_count"] == 0
        and diagnostics["operation_failure_total"] == 0
    ):
        return False

    with _runtime_lock:
        global _last_emitted_snapshot
        if _last_emitted_snapshot == diagnostics:
            return False
        _last_emitted_snapshot = dict(diagnostics)

    logger.info(
        "redis_runtime_snapshot",
        extra={
            "event": "redis_runtime_snapshot",
            "redis_unavailable_scopes": diagnostics["unavailable_scopes"],
            "redis_unavailable_scope_counts": diagnostics["unavailable_scope_counts"],
            "redis_unavailable_scope_total": diagnostics["unavailable_scope_total"],
            "redis_degraded_scope_count": diagnostics["degraded_scope_count"],
            "redis_last_unavailable_at": diagnostics["last_unavailable_at"],
            "redis_operation_failures": diagnostics["operation_failures"],
            "redis_operation_failure_total": diagnostics["operation_failure_total"],
            "redis_last_operation_failure_at": diagnostics["last_operation_failure_at"],
        },
    )
    return True


def evaluate_runtime_alert(
    diagnostics: dict[str, Any],
    *,
    degraded_scope_threshold: int,
    operation_failure_threshold: int,
) -> dict[str, Any]:
    normalized_scope_threshold = max(int(degraded_scope_threshold), 1)
    normalized_failure_threshold = max(int(operation_failure_threshold), 1)
    reasons: list[str] = []
    status = "ok"

    degraded_scope_count = int(diagnostics.get("degraded_scope_count") or 0)
    operation_failure_total = int(diagnostics.get("operation_failure_total") or 0)

    if degraded_scope_count >= normalized_scope_threshold:
        status = "critical"
        reasons.append(
            f"degraded_scope_count={degraded_scope_count} reached threshold {normalized_scope_threshold}"
        )

    if operation_failure_total >= normalized_failure_threshold:
        if status != "critical":
            status = "warning"
        reasons.append(
            f"operation_failure_total={operation_failure_total} reached threshold {normalized_failure_threshold}"
        )

    return {
        "status": status,
        "should_alert": bool(reasons),
        "reasons": reasons,
        "degraded_scope_threshold": normalized_scope_threshold,
        "operation_failure_threshold": normalized_failure_threshold,
    }


def emit_runtime_alert_event(
    logger: logging.Logger,
    *,
    diagnostics: dict[str, Any],
    alert: dict[str, Any],
) -> bool:
    if not alert.get("should_alert"):
        return False

    snapshot = {
        "status": alert["status"],
        "reasons": list(alert["reasons"]),
        "degraded_scope_count": diagnostics.get("degraded_scope_count", 0),
        "operation_failure_total": diagnostics.get("operation_failure_total", 0),
        "degraded_scope_threshold": alert["degraded_scope_threshold"],
        "operation_failure_threshold": alert["operation_failure_threshold"],
    }

    with _runtime_lock:
        global _last_emitted_alert_snapshot
        if _last_emitted_alert_snapshot == snapshot:
            return False
        _last_emitted_alert_snapshot = dict(snapshot)

    logger.warning(
        "redis_runtime_alert",
        extra={
            "event": "redis_runtime_alert",
            "severity": alert["status"],
            "reasons": alert["reasons"],
            "redis_degraded_scope_count": diagnostics.get("degraded_scope_count", 0),
            "redis_operation_failure_total": diagnostics.get("operation_failure_total", 0),
            "redis_degraded_scope_threshold": alert["degraded_scope_threshold"],
            "redis_operation_failure_threshold": alert["operation_failure_threshold"],
        },
    )
    return True


def reset_runtime_diagnostics() -> None:
    with _runtime_lock:
        global _last_unavailable_at, _last_operation_failure_at, _last_emitted_snapshot, _last_emitted_alert_snapshot
        _warned_unavailable_scopes.clear()
        _unavailable_scope_counts.clear()
        _operation_failure_counts.clear()
        _last_unavailable_at = None
        _last_operation_failure_at = None
        _last_emitted_snapshot = None
        _last_emitted_alert_snapshot = None
