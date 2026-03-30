import hashlib
import json
import logging
import time
from dataclasses import asdict, dataclass
from threading import Lock
from typing import Any

from app.core.config import get_settings

try:
    import redis
except ImportError:  # pragma: no cover - local fallback remains available
    redis = None

logger = logging.getLogger(__name__)

_STATE_PREFIX = "admin_sso:state:"
_LOGOUT_HINT_PREFIX = "admin_sso:logout_hint:"

_local_store: dict[str, tuple[float, str]] = {}
_local_store_lock = Lock()
_redis_client: Any | None = None
_redis_url: str | None = None


@dataclass(frozen=True)
class AdminSsoLoginArtifact:
    nonce: str
    code_verifier: str
    next_path: str
    created_at: float


def _hash_key(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _local_cleanup(now: float | None = None) -> None:
    current = now or time.time()
    expired_keys = [key for key, (expires_at, _) in _local_store.items() if expires_at <= current]
    for key in expired_keys:
        _local_store.pop(key, None)


def _get_redis_client():
    settings = get_settings()
    redis_url = (settings.redis_url or "").strip() or None
    if not redis_url or redis is None:
        return None

    global _redis_client, _redis_url
    if _redis_client is not None and _redis_url == redis_url:
        return _redis_client

    try:
        _redis_client = redis.Redis.from_url(redis_url, decode_responses=True)
        _redis_url = redis_url
    except Exception:
        logger.warning("Admin SSO artifact store could not initialize Redis; falling back to in-memory store.", exc_info=True)
        _redis_client = None
        _redis_url = None
    return _redis_client


def _set_json(key: str, payload: dict[str, Any], ttl_seconds: int) -> None:
    client = _get_redis_client()
    encoded = json.dumps(payload)
    if client is not None:
        try:
            client.setex(key, max(ttl_seconds, 1), encoded)
            return
        except Exception:
            logger.warning("Admin SSO artifact store failed to write to Redis; using in-memory fallback.", exc_info=True)

    with _local_store_lock:
        _local_cleanup()
        _local_store[key] = (time.time() + max(ttl_seconds, 1), encoded)


def _pop_json(key: str) -> dict[str, Any] | None:
    client = _get_redis_client()
    if client is not None:
        try:
            payload = client.getdel(key)
            if payload is None:
                return None
            decoded = json.loads(payload)
            return decoded if isinstance(decoded, dict) else None
        except Exception:
            logger.warning("Admin SSO artifact store failed to read from Redis; falling back to in-memory store.", exc_info=True)

    with _local_store_lock:
        _local_cleanup()
        entry = _local_store.pop(key, None)
    if entry is None:
        return None
    _, payload = entry
    decoded = json.loads(payload)
    return decoded if isinstance(decoded, dict) else None


def _delete_key(key: str) -> None:
    client = _get_redis_client()
    if client is not None:
        try:
            client.delete(key)
        except Exception:
            logger.warning("Admin SSO artifact store failed to delete Redis key; continuing with in-memory cleanup.", exc_info=True)

    with _local_store_lock:
        _local_store.pop(key, None)


def store_login_artifact(*, state_token: str, nonce: str, code_verifier: str, next_path: str) -> None:
    settings = get_settings()
    artifact = AdminSsoLoginArtifact(
        nonce=nonce,
        code_verifier=code_verifier,
        next_path=next_path,
        created_at=time.time(),
    )
    _set_json(
        f"{_STATE_PREFIX}{_hash_key(state_token)}",
        asdict(artifact),
        settings.admin_oidc_state_ttl_seconds,
    )


def pop_login_artifact(state_token: str) -> AdminSsoLoginArtifact | None:
    payload = _pop_json(f"{_STATE_PREFIX}{_hash_key(state_token)}")
    if payload is None:
        return None
    try:
        return AdminSsoLoginArtifact(
            nonce=str(payload["nonce"]),
            code_verifier=str(payload["code_verifier"]),
            next_path=str(payload["next_path"]),
            created_at=float(payload["created_at"]),
        )
    except (KeyError, TypeError, ValueError):
        return None


def clear_login_artifact(state_token: str) -> None:
    _delete_key(f"{_STATE_PREFIX}{_hash_key(state_token)}")


def store_logout_hint(*, session_id: str, id_token_hint: str, ttl_seconds: int) -> None:
    if not session_id or not id_token_hint:
        return
    _set_json(
        f"{_LOGOUT_HINT_PREFIX}{_hash_key(session_id)}",
        {"id_token_hint": id_token_hint, "created_at": time.time()},
        ttl_seconds,
    )


def pop_logout_hint(session_id: str | None) -> str | None:
    if not session_id:
        return None
    payload = _pop_json(f"{_LOGOUT_HINT_PREFIX}{_hash_key(session_id)}")
    if payload is None:
        return None
    value = payload.get("id_token_hint")
    return str(value) if isinstance(value, str) and value else None


def clear_logout_hint(session_id: str | None) -> None:
    if not session_id:
        return
    _delete_key(f"{_LOGOUT_HINT_PREFIX}{_hash_key(session_id)}")


def reset_runtime_state() -> None:
    global _redis_client, _redis_url
    with _local_store_lock:
        _local_store.clear()
    _redis_client = None
    _redis_url = None
