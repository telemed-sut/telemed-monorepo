import hashlib
import json
import time
from dataclasses import asdict, dataclass
from threading import Lock
from typing import Any

from app.core.config import get_settings

_STATE_PREFIX = "admin_sso:state:"
_LOGOUT_HINT_PREFIX = "admin_sso:logout_hint:"

_local_store: dict[str, tuple[float, str]] = {}
_local_store_lock = Lock()


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


def _set_json(key: str, payload: dict[str, Any], ttl_seconds: int) -> None:
    encoded = json.dumps(payload)
    with _local_store_lock:
        _local_cleanup()
        _local_store[key] = (time.time() + max(ttl_seconds, 1), encoded)


def _pop_json(key: str) -> dict[str, Any] | None:
    with _local_store_lock:
        _local_cleanup()
        entry = _local_store.pop(key, None)
    if entry is None:
        return None
    _, payload = entry
    decoded = json.loads(payload)
    return decoded if isinstance(decoded, dict) else None


def _delete_key(key: str) -> None:
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
    with _local_store_lock:
        _local_store.clear()
