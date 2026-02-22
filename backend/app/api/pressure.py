import hashlib
import hmac
import json
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.services.auth import get_db
from app.schemas.pressure import PressureCreate, PressureResponse
from app.services.pressure import pressure_service
from app.core.config import get_settings
from app.core.limiter import limiter
from app.models.device_error_log import DeviceErrorLog
from app.models.device_request_nonce import DeviceRequestNonce
from app.core.request_utils import get_client_ip

router = APIRouter()
settings = get_settings()
logger = logging.getLogger(__name__)

MAX_TIMESTAMP_DIFF = 300  # 5 minutes
GENERIC_AUTH_ERROR = "Invalid signature"


def log_device_error(db: Session, device_id: str, error_msg: str, request: Request):
    try:
        ip = get_client_ip(request)
        endpoint = str(request.url)

        error_log = DeviceErrorLog(
            device_id=device_id,
            error_message=error_msg,
            ip_address=ip,
            endpoint=endpoint,
        )
        db.add(error_log)
        db.commit()
    except Exception:
        logger.exception("Failed to log device error for device=%s", device_id)


def _resolve_device_secret(device_id: str) -> str:
    device_secret = settings.device_api_secrets.get(device_id)
    if device_secret:
        return device_secret

    if settings.device_api_require_registered_device:
        raise ValueError("unregistered_device")

    if settings.device_api_secret:
        return settings.device_api_secret

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
    expires_at = now_utc + timedelta(seconds=settings.device_api_nonce_ttl_seconds)

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
        if len(normalized_signature) != 64:
            raise ValueError("invalid_signature_length")

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
        if not raw_body:
            raise ValueError("missing_body")
        if len(raw_body) > settings.device_api_max_body_bytes:
            raise ValueError("body_too_large")

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("invalid_json")

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

        device_secret = _resolve_device_secret(normalized_device_id)

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

        if normalized_nonce:
            _consume_nonce(db, normalized_device_id, normalized_nonce)

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


@router.post("/device/v1/pressure", response_model=PressureResponse, status_code=201)
@limiter.limit("60/minute")
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
        # If the device omits measured_at, use signed request timestamp (UTC) to preserve ordering.
        if pressure_in.measured_at is None:
            signed_ts = getattr(request.state, "device_request_timestamp", int(time.time()))
            pressure_in = pressure_in.model_copy(
                update={"measured_at": datetime.fromtimestamp(signed_ts, tz=timezone.utc)}
            )

        record = pressure_service.create_pressure(db, pressure_in)
        return {
            "id": record.id,
            "received_at": record.created_at,
            "patient_id": record.patient_id,
        }
    except HTTPException as e:
        # Log known HTTP exceptions (like Patient not found)
        log_device_error(db, pressure_in.device_id, f"HTTP {e.status_code}: {e.detail}", request)
        raise
    except Exception as e:
        # Log unexpected errors
        log_device_error(db, pressure_in.device_id, f"Internal Error: {str(e)}", request)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error",
        )


@router.post("/add_pressure", response_model=PressureResponse, status_code=201, deprecated=True)
@limiter.limit("60/minute")
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
