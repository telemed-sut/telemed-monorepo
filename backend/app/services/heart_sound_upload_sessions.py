from __future__ import annotations

import hashlib
import json
import secrets
import time
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any, TypedDict
from uuid import UUID

_UPLOAD_SESSION_PREFIX = "heart_sound_upload_session:v1:"
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


def _set_json(key: str, payload: dict[str, Any], ttl_seconds: int) -> None:
    encoded = json.dumps(payload)
    with _local_store_lock:
        _local_cleanup()
        _local_store[key] = (time.time() + max(ttl_seconds, 1), encoded)


def _get_json(key: str) -> dict[str, Any] | None:
    with _local_store_lock:
        _local_cleanup()
        entry = _local_store.get(key)
    if entry is None:
        return None
    _, payload = entry
    decoded = json.loads(payload)
    return decoded if isinstance(decoded, dict) else None


def _delete_json(key: str) -> None:
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

    expires_at_raw = payload.get("expires_at")
    try:
        expires_at = (
            datetime.fromisoformat(expires_at_raw)
            if isinstance(expires_at_raw, str) and expires_at_raw
            else None
        )
    except ValueError:
        expires_at = None
    if expires_at is None or expires_at <= datetime.now(timezone.utc):
        delete_upload_session(session_id)
        return None

    normalized_session_id = payload.get("session_id")
    patient_id = payload.get("patient_id")
    user_id = payload.get("user_id")
    filename = payload.get("filename")
    blob_url = payload.get("blob_url")
    storage_key = payload.get("storage_key")
    mime_type = payload.get("mime_type")
    recorded_at = payload.get("recorded_at")

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
