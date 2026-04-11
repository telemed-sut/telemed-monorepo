"""Shared Redis runtime helpers for optional cache-backed services."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from app.db.session import get_redis_client

_warned_unavailable_scopes: set[str] = set()


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
        if scope not in _warned_unavailable_scopes:
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
            _warned_unavailable_scopes.add(scope)
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
