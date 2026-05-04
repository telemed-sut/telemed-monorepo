import hashlib
import hmac
import json
import logging
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.services.auth import get_db, verify_patient_access
from app.schemas.pressure import PressureCreate, PressureIngestResponse, PressureListResponse
from app.services.pressure import pressure_service
from app.core.config import get_settings
from app.core.limiter import get_device_ingest_rate_limit_key, limiter
from app.models.device_registration import DeviceRegistration
from app.models.device_error_log import DeviceErrorLog
from app.models.device_request_nonce import DeviceRequestNonce
from app.models.user import User
from app.core.request_utils import get_client_ip
from app.core.secret_crypto import SecretDecryptionError
from app.services.redis_cache import get_cached_device_secret, set_cached_device_secret
from app.services.redis_runtime import get_redis_client_or_log, log_redis_operation_failure

router = APIRouter()
settings = get_settings()
logger = logging.getLogger(__name__)

MAX_TIMESTAMP_DIFF = 300  # 5 minutes
GENERIC_AUTH_ERROR = "Invalid signature"
_SAFE_DEVICE_ERROR_TOKEN_RE = re.compile(r"[^a-z0-9_:-]+")
_MAX_DEVICE_ERROR_MESSAGE_LENGTH = 256
_DEVICE_NONCE_REDIS_PREFIX = "device_nonce:v1:"
_REDIS_SCOPE = "device nonce replay cache"
_FALLBACK_LABEL = "database nonce table"


def sanitize_device_error_message(error_msg: str) -> str:
    normalized = " ".join((error_msg or "").strip().split())
    if not normalized:
        return "unknown_error"

    if normalized.startswith("VALIDATION_FAILED:"):
        return normalized[:_MAX_DEVICE_ERROR_MESSAGE_LENGTH]

    if normalized.startswith("AUTH_FAILED:"):
        prefix, _, detail = normalized.partition(":")
        safe_detail = _SAFE_DEVICE_ERROR_TOKEN_RE.sub("_", detail.lower()).strip("_") or "unknown"
        return f"{prefix}:{safe_detail}"[:_MAX_DEVICE_ERROR_MESSAGE_LENGTH]

    if normalized.startswith("HTTP "):
        parts = normalized.split(" ", 2)
        if len(parts) >= 2:
            status_code = parts[1].rstrip(":")
            if status_code.isdigit():
                return f"HTTP_ERROR:{status_code}"[:_MAX_DEVICE_ERROR_MESSAGE_LENGTH]
        return "HTTP_ERROR:unknown"

    if normalized.startswith("INTERNAL_ERROR:"):
        prefix, _, detail = normalized.partition(":")
        safe_detail = _SAFE_DEVICE_ERROR_TOKEN_RE.sub("_", detail.lower()).strip("_") or "unexpected"
        return f"{prefix}:{safe_detail}"[:_MAX_DEVICE_ERROR_MESSAGE_LENGTH]

    safe_value = _SAFE_DEVICE_ERROR_TOKEN_RE.sub("_", normalized.lower()).strip("_") or "unexpected_error"
    return safe_value[:_MAX_DEVICE_ERROR_MESSAGE_LENGTH]


def log_device_error(db: Session, device_id: str, error_msg: str, request: Request):
    try:
        ip = get_client_ip(request)
        endpoint = str(request.url)

        error_log = DeviceErrorLog(
            device_id=device_id,
            error_message=sanitize_device_error_message(error_msg),
            ip_address=ip,
            endpoint=endpoint,
        )
        db.add(error_log)
        db.commit()
    except Exception:
        logger.exception("Failed to log device error for device=%s", device_id)

def _resolve_device_secret(db: Session, device_id: str) -> tuple[str, DeviceRegistration | None]:
    # 1. Try to resolve from Redis cache first
    cached_secret = get_cached_device_secret(device_id)
    if cached_secret:
        # If cached, we still might want the registration object if it exists
        # But to avoid a DB hit just to check existence, we return the secret immediately
        # if the caller (verify_device_signature) doesn't strictly need the DB object
        # for authorization, only for secret resolution.
        # However, verify_device_signature uses registered_device to update last_seen_at.
        # So we only skip DB if it's not a registered device or if we accept delayed last_seen_at.
        # For now, let's look up DB but only if secret is NOT in cache or if it's a registered device.
        pass

    registered_device = db.scalar(
        select(DeviceRegistration).where(DeviceRegistration.device_id == device_id)
    )
    if registered_device:
        if not registered_device.is_active:
            raise ValueError("device_inactive")
        try:
            secret = (registered_device.device_secret or "").strip()
        except SecretDecryptionError as exc:
            raise ValueError("device_secret_unavailable") from exc
        if not secret:
            raise ValueError("missing_device_secret")
        
        # Cache it for next time
        set_cached_device_secret(device_id, secret)
        return secret, registered_device

    # 2. Check settings (static secrets)
    device_secret = settings.device_api_secrets.get(device_id)
    if device_secret:
        set_cached_device_secret(device_id, device_secret)
        return device_secret, None

    if settings.device_api_require_registered_device:
        raise ValueError("unregistered_device")

    if settings.device_api_secret:
        set_cached_device_secret(device_id, settings.device_api_secret)
        return settings.device_api_secret, None

    raise ValueError("missing_device_secret")


def _compute_signature(
    secret: str,
    timestamp: str,
    device_id: str,
    body_hash: str | None = None,
    nonce: str | None = None,
) -> str:
    message = f"{timestamp}{device_id}"
    if body_hash:
        message += body_hash
    if nonce:
        message += nonce

    return hmac.new(
        secret.encode(),
        message.encode(),
        hashlib.sha256,
    ).hexdigest()


def _consume_nonce(db: Session, device_id: str, nonce: str) -> None:
    nonce_hash = hashlib.sha256(nonce.encode("utf-8")).hexdigest()
    now_utc = datetime.now(timezone.utc)
    ttl_seconds = max(int(settings.device_api_nonce_ttl_seconds), 1)
    expires_at = now_utc + timedelta(seconds=ttl_seconds)

    redis_client = get_redis_client_or_log(
        logger,
        scope=_REDIS_SCOPE,
        fallback_label=_FALLBACK_LABEL,
    )
    if redis_client is not None:
        redis_key = f"{_DEVICE_NONCE_REDIS_PREFIX}{device_id}:{nonce_hash}"
        try:
            stored = redis_client.set(redis_key, "1", ex=ttl_seconds, nx=True)
            if not stored:
                raise ValueError("replay_nonce")
            return
        except ValueError:
            raise
        except Exception:
            log_redis_operation_failure(
                logger,
                scope=_REDIS_SCOPE,
                operation="consume_nonce",
                fallback_label=_FALLBACK_LABEL,
            )

    # Opportunistic cleanup to keep nonce table bounded without a background scheduler.
    db.query(DeviceRequestNonce).filter(DeviceRequestNonce.expires_at <= now_utc).delete(
        synchronize_session=False
    )

    nonce_row = DeviceRequestNonce(
        device_id=device_id,
        nonce_hash=nonce_hash,
        expires_at=expires_at,
    )
    db.add(nonce_row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ValueError("replay_nonce")


async def verify_device_signature(
    request: Request,
    x_device_id: str | None = Header(default=None, alias="X-Device-Id"),
    x_timestamp: str | None = Header(default=None, alias="X-Timestamp"),
    x_signature: str | None = Header(default=None, alias="X-Signature"),
    x_body_hash: str | None = Header(default=None, alias="X-Body-Hash"),
    x_nonce: str | None = Header(default=None, alias="X-Nonce"),
    db: Session = Depends(get_db),
):
    try:
        if not x_device_id or not x_timestamp or not x_signature:
            raise ValueError("missing_required_headers")

        normalized_device_id = x_device_id.strip()
        if not normalized_device_id:
            raise ValueError("invalid_device_id")

        normalized_signature = x_signature.strip().lower()
        if not normalized_signature:
            raise ValueError("empty_signature")
        # Use a consistent failure mode for invalid signature length
        if len(normalized_signature) != 64:
            raise ValueError("invalid_signature")

        normalized_nonce = x_nonce.strip() if x_nonce else None
        if settings.device_api_require_nonce and not normalized_nonce:
            raise ValueError("missing_nonce")
        if normalized_nonce and (len(normalized_nonce) < 8 or len(normalized_nonce) > 128):
            raise ValueError("invalid_nonce")

        # 1. Verify timestamp to prevent replay attacks
        try:
            ts = int(x_timestamp)
        except ValueError:
            raise ValueError("invalid_timestamp_format")

        current_ts = int(time.time())
        if abs(current_ts - ts) > MAX_TIMESTAMP_DIFF:
            raise ValueError("timestamp_out_of_window")

        # 2. Read and validate body payload details used in signature checks
        raw_body = await request.body()
        if len(raw_body) > settings.device_api_max_body_bytes:
            raise ValueError("body_too_large")

        if raw_body:
            try:
                payload = json.loads(raw_body.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                raise ValueError("invalid_json")
        else:
            payload = {}

        payload_device_id = payload.get("device_id")
        if (
            isinstance(payload_device_id, str)
            and payload_device_id.strip()
            and payload_device_id.strip() != normalized_device_id
        ):
            raise ValueError("device_id_mismatch")

        computed_body_hash = hashlib.sha256(raw_body).hexdigest()
        normalized_body_hash = x_body_hash.strip().lower() if x_body_hash else None

        if settings.device_api_require_body_hash_signature and not normalized_body_hash:
            raise ValueError("missing_body_hash")

        if normalized_body_hash and not hmac.compare_digest(computed_body_hash, normalized_body_hash):
            raise ValueError("invalid_body_hash")

        device_secret, registered_device = _resolve_device_secret(db, normalized_device_id)

        # 3. Verify signature (legacy: timestamp+device_id, hardened: +body_hash(+nonce))
        expected_signature = _compute_signature(
            device_secret,
            x_timestamp,
            normalized_device_id,
            body_hash=normalized_body_hash,
            nonce=normalized_nonce,
        )

        if not hmac.compare_digest(expected_signature, normalized_signature):
            raise ValueError("invalid_signature")

        if registered_device:
            registered_device.last_seen_at = datetime.now(timezone.utc)
            db.add(registered_device)

        if normalized_nonce:
            _consume_nonce(db, normalized_device_id, normalized_nonce)

        if registered_device or normalized_nonce:
            db.commit()

        request.state.device_request_timestamp = ts
        return True

    except ValueError as e:
        log_device_error(db, (x_device_id or "unknown"), f"AUTH_FAILED:{e}", request)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=GENERIC_AUTH_ERROR,
        )
    except Exception:
        log_device_error(db, (x_device_id or "unknown"), "AUTH_FAILED:unexpected_security_error", request)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=GENERIC_AUTH_ERROR,
        )


@router.post("/device/v1/pressure", response_model=PressureIngestResponse, status_code=201)
@limiter.limit("60/minute", key_func=get_device_ingest_rate_limit_key)
def create_pressure_record(
    request: Request,
    *,
    db: Session = Depends(get_db),
    pressure_in: PressureCreate,
    authorized: bool = Depends(verify_device_signature),
) -> Any:
    """
    Receive blood pressure data from physical device.
    """
    try:
        signed_ts = getattr(request.state, "device_request_timestamp", int(time.time()))
        measured_at = datetime.fromtimestamp(signed_ts, tz=timezone.utc)

        pressure_service.create_pressure(db, pressure_in, measured_at=measured_at)
        # Keep device acknowledgement minimal; do not leak internal record identifiers.
        return {"status": "ok"}
    except HTTPException as e:
        # Log known HTTP exceptions (like Patient not found)
        log_device_error(db, pressure_in.device_id, f"HTTP {e.status_code}", request)
        raise
    except Exception as e:
        # Log unexpected errors
        log_device_error(db, pressure_in.device_id, f"INTERNAL_ERROR:{e.__class__.__name__}", request)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error",
        )


@router.post("/add_pressure", response_model=PressureIngestResponse, status_code=201, deprecated=True)
@limiter.limit("60/minute", key_func=get_device_ingest_rate_limit_key)
def add_pressure_alias(
    request: Request,
    response: Response,
    *,
    db: Session = Depends(get_db),
    pressure_in: PressureCreate,
    authorized: bool = Depends(verify_device_signature),
):
    """
    Alias for /device/v1/pressure for backward compatibility.
    """
    response.headers["Deprecation"] = "true"
    response.headers["Warning"] = '299 - "/add_pressure is deprecated; use /device/v1/pressure"'
    # Simply call the main logic
    return create_pressure_record(request=request, db=db, pressure_in=pressure_in, authorized=authorized)


@router.get("/patients/{patient_id}/pressure-readings", response_model=PressureListResponse)
@limiter.limit("60/minute")
def get_patient_pressure_readings(
    request: Request,
    patient_id: UUID,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(verify_patient_access),
):
    items, total = pressure_service.list_patient_pressure_records(
        db,
        patient_id,
        limit=limit,
        offset=offset,
    )
    serialized_items = [pressure_service.serialize_pressure_record(item) for item in items]
    return PressureListResponse(
        items=serialized_items,
        total=total,
        limit=limit,
        offset=offset,
        latest=serialized_items[0] if offset == 0 and serialized_items else None,
    )
