from __future__ import annotations

import hashlib
import json
import logging
import secrets
import time
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any, TypedDict
from uuid import UUID

from app.core.config import get_settings
from app.db.session import get_redis_client
from app.services.redis_runtime import (
    allows_local_runtime_fallback,
    decode_cached_value,
    get_redis_client_or_log,
    log_redis_operation_failure,
    parse_cached_datetime,
    raise_redis_runtime_required,
)

logger = logging.getLogger(__name__)

_UPLOAD_SESSION_PREFIX = "heart_sound_upload_session:v1:"
_REDIS_SCOPE = "heart sound upload session store"
_FALLBACK_LABEL = "local in-memory upload session store"
_local_store: dict[str, tuple[float, str]] = {}
_local_store_lock = Lock()


class HeartSoundUploadSessionPayload(TypedDict):
    session_id: str
    patient_id: str
    user_id: str
    position: int
    filename: str
    blob_url: str
    storage_key: str
    mime_type: str | None
    file_size_bytes: int
    expires_at: str
    recorded_at: str | None


def _hash_key(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _cache_key(session_id: str) -> str:
    return f"{_UPLOAD_SESSION_PREFIX}{_hash_key(session_id)}"


def _local_cleanup(now: float | None = None) -> None:
    current = now or time.time()
    expired_keys = [key for key, (expires_at, _) in _local_store.items() if expires_at <= current]
    for key in expired_keys:
        _local_store.pop(key, None)


def _allows_local_fallback() -> bool:
    return allows_local_runtime_fallback(get_settings().app_env)


def _get_store_redis_client():
    if _allows_local_fallback():
        return get_redis_client_or_log(
            logger,
            scope=_REDIS_SCOPE,
            fallback_label=_FALLBACK_LABEL,
        )
    return get_redis_client()


def _require_shared_redis_state() -> None:
    raise_redis_runtime_required(
        logger,
        scope=_REDIS_SCOPE,
        app_env=get_settings().app_env,
    )


def _set_json(key: str, payload: dict[str, Any], ttl_seconds: int) -> None:
    client = _get_store_redis_client()
    encoded = json.dumps(payload)
    if client is not None:
        try:
            client.setex(key, max(ttl_seconds, 1), encoded)
            return
        except Exception:
            if not _allows_local_fallback():
                _require_shared_redis_state()
            log_redis_operation_failure(
                logger,
                scope=_REDIS_SCOPE,
                operation="write",
                fallback_label=_FALLBACK_LABEL,
            )

    if not _allows_local_fallback():
        _require_shared_redis_state()

    with _local_store_lock:
        _local_cleanup()
        _local_store[key] = (time.time() + max(ttl_seconds, 1), encoded)


def _get_json(key: str) -> dict[str, Any] | None:
    client = _get_store_redis_client()
    if client is not None:
        try:
            payload = client.get(key)
            if payload is None:
                return None
            decoded_payload = decode_cached_value(payload)
            if decoded_payload is None:
                return None
            decoded = json.loads(decoded_payload)
            return decoded if isinstance(decoded, dict) else None
        except Exception:
            if not _allows_local_fallback():
                _require_shared_redis_state()
            log_redis_operation_failure(
                logger,
                scope=_REDIS_SCOPE,
                operation="read",
                fallback_label=_FALLBACK_LABEL,
            )

    if not _allows_local_fallback():
        _require_shared_redis_state()

    with _local_store_lock:
        _local_cleanup()
        entry = _local_store.get(key)
    if entry is None:
        return None
    _, payload = entry
    decoded = json.loads(payload)
    return decoded if isinstance(decoded, dict) else None


def _delete_json(key: str) -> None:
    client = _get_store_redis_client()
    if client is not None:
        try:
            client.delete(key)
            return
        except Exception:
            if not _allows_local_fallback():
                _require_shared_redis_state()
            log_redis_operation_failure(
                logger,
                scope=_REDIS_SCOPE,
                operation="delete",
                fallback_label=_FALLBACK_LABEL,
            )

    if not _allows_local_fallback():
        _require_shared_redis_state()

    with _local_store_lock:
        _local_store.pop(key, None)


def create_upload_session(
    *,
    patient_id: UUID,
    user_id: UUID,
    position: int,
    filename: str,
    blob_url: str,
    storage_key: str,
    mime_type: str | None,
    file_size_bytes: int,
    recorded_at: datetime | None,
    ttl_seconds: int,
) -> HeartSoundUploadSessionPayload:
    session_id = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=max(ttl_seconds, 1))
    payload: HeartSoundUploadSessionPayload = {
        "session_id": session_id,
        "patient_id": str(patient_id),
        "user_id": str(user_id),
        "position": int(position),
        "filename": filename.strip(),
        "blob_url": blob_url,
        "storage_key": storage_key,
        "mime_type": (mime_type or "").strip() or None,
        "file_size_bytes": int(file_size_bytes),
        "expires_at": expires_at.isoformat(),
        "recorded_at": recorded_at.astimezone(timezone.utc).isoformat() if recorded_at else None,
    }
    _set_json(_cache_key(session_id), payload, ttl_seconds)
    return payload


def get_upload_session(session_id: str) -> HeartSoundUploadSessionPayload | None:
    payload = _get_json(_cache_key(session_id))
    if not payload:
        return None

    expires_at = parse_cached_datetime(payload.get("expires_at"))
    if expires_at is None or expires_at <= datetime.now(timezone.utc):
        delete_upload_session(session_id)
        return None

    normalized_session_id = decode_cached_value(payload.get("session_id"))
    patient_id = decode_cached_value(payload.get("patient_id"))
    user_id = decode_cached_value(payload.get("user_id"))
    filename = decode_cached_value(payload.get("filename"))
    blob_url = decode_cached_value(payload.get("blob_url"))
    storage_key = decode_cached_value(payload.get("storage_key"))
    mime_type = decode_cached_value(payload.get("mime_type"))
    recorded_at = decode_cached_value(payload.get("recorded_at"))

    if not all([normalized_session_id, patient_id, user_id, filename, blob_url, storage_key]):
        delete_upload_session(session_id)
        return None

    position_raw = payload.get("position")
    file_size_bytes_raw = payload.get("file_size_bytes")
    try:
        position = int(position_raw)
        file_size_bytes = int(file_size_bytes_raw)
    except (TypeError, ValueError):
        delete_upload_session(session_id)
        return None

    return {
        "session_id": normalized_session_id,
        "patient_id": patient_id,
        "user_id": user_id,
        "position": position,
        "filename": filename,
        "blob_url": blob_url,
        "storage_key": storage_key,
        "mime_type": mime_type,
        "file_size_bytes": file_size_bytes,
        "expires_at": expires_at.isoformat(),
        "recorded_at": recorded_at,
    }


def delete_upload_session(session_id: str) -> None:
    if not session_id:
        return
    _delete_json(_cache_key(session_id))


def reset_runtime_state() -> None:
    with _local_store_lock:
        _local_store.clear()
