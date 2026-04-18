import hashlib
import json
import logging
import time
from base64 import urlsafe_b64encode
from threading import Lock
from typing import Any, TypedDict

from app.core.config import get_settings
from app.db.session import get_redis_client
from app.services.redis_runtime import (
    allows_local_runtime_fallback,
    decode_cached_value,
    get_redis_client_or_log,
    log_redis_operation_failure,
    raise_redis_runtime_required,
)

logger = logging.getLogger(__name__)

_CHALLENGE_PREFIX = "passkey:challenge:"
_REDIS_SCOPE = "passkey challenge store"
_FALLBACK_LABEL = "local in-memory challenge store"
_local_store: dict[str, tuple[float, str]] = {}
_local_store_lock = Lock()


class ChallengePayload(TypedDict, total=False):
    challenge: str
    origin: str
    rp_id: str
    user_verification: str

def _hash_key(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()

def _local_cleanup(now: float | None = None) -> None:
    current = now or time.time()
    expired_keys = [key for key, (expires_at, _) in _local_store.items() if expires_at <= current]
    for key in expired_keys:
        _local_store.pop(key, None)


def _allows_local_fallback() -> bool:
    settings = get_settings()
    return allows_local_runtime_fallback(settings.app_env)


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

def _pop_json(key: str) -> dict[str, Any] | None:
    client = _get_store_redis_client()
    if client is not None:
        try:
            payload = client.getdel(key)
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
        entry = _local_store.pop(key, None)
    if entry is None:
        return None
    _, payload = entry
    decoded = json.loads(payload)
    return decoded if isinstance(decoded, dict) else None

def _bytes_to_base64url(value: bytes) -> str:
    return urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _normalize_challenge(challenge: str | bytes) -> str:
    if isinstance(challenge, bytes):
        return _bytes_to_base64url(challenge)

    normalized = challenge.strip()
    if not normalized:
        raise ValueError("Challenge must be non-empty")
    return normalized


def store_challenge(
    session_id: str,
    challenge: str | bytes,
    *,
    origin: str | None = None,
    rp_id: str | None = None,
    user_verification: str | None = None,
    ttl_seconds: int = 300,
) -> None:
    payload: ChallengePayload = {
        "challenge": _normalize_challenge(challenge),
    }
    if origin:
        payload["origin"] = origin
    if rp_id:
        payload["rp_id"] = rp_id
    if user_verification:
        payload["user_verification"] = user_verification

    _set_json(f"{_CHALLENGE_PREFIX}{_hash_key(session_id)}", payload, ttl_seconds)


def pop_challenge(session_id: str) -> ChallengePayload | None:
    payload = _pop_json(f"{_CHALLENGE_PREFIX}{_hash_key(session_id)}")
    if not payload:
        return None

    challenge = payload.get("challenge")
    if not isinstance(challenge, str) or not challenge.strip():
        return None

    normalized: ChallengePayload = {"challenge": challenge.strip()}

    origin = payload.get("origin")
    if isinstance(origin, str) and origin.strip():
        normalized["origin"] = origin.strip()

    rp_id = payload.get("rp_id")
    if isinstance(rp_id, str) and rp_id.strip():
        normalized["rp_id"] = rp_id.strip()

    user_verification = payload.get("user_verification")
    if isinstance(user_verification, str) and user_verification.strip():
        normalized["user_verification"] = user_verification.strip()

    return normalized


def reset_runtime_state() -> None:
    with _local_store_lock:
        _local_store.clear()
