from fastapi import APIRouter, Depends, HTTPException, Header, Request, status
from sqlalchemy.orm import Session
from typing import Any
import hmac
import hashlib
import time
import json
from datetime import datetime, timezone

from app.services.auth import get_db
from app.schemas.pressure import PressureCreate, PressureResponse
from app.services.pressure import pressure_service
from app.core.config import get_settings
from app.core.limiter import limiter
from app.models.device_error_log import DeviceErrorLog

router = APIRouter()
settings = get_settings()

MAX_TIMESTAMP_DIFF = 300  # 5 minutes

def log_device_error(db: Session, device_id: str, error_msg: str, request: Request):
    try:
        ip = request.client.host if request.client else "unknown"
        endpoint = str(request.url)
        
        error_log = DeviceErrorLog(
            device_id=device_id,
            error_message=error_msg,
            ip_address=ip,
            endpoint=endpoint
        )
        db.add(error_log)
        db.commit()
    except Exception as e:
        print(f"Failed to log device error: {e}")

def _compute_signature(timestamp: str, device_id: str, body_hash: str | None = None) -> str:
    message = f"{timestamp}{device_id}"
    if body_hash:
        message += body_hash
    return hmac.new(
        settings.device_api_secret.encode(),
        message.encode(),
        hashlib.sha256
    ).hexdigest()


async def verify_device_signature(
    request: Request,
    x_device_id: str = Header(..., alias="X-Device-Id"),
    x_timestamp: str = Header(..., alias="X-Timestamp"),
    x_signature: str = Header(..., alias="X-Signature"),
    x_body_hash: str | None = Header(default=None, alias="X-Body-Hash"),
    db: Session = Depends(get_db)
):
    try:
        normalized_device_id = x_device_id.strip()
        if not normalized_device_id:
            raise ValueError("Invalid device id")

        normalized_signature = x_signature.strip().lower()
        if not normalized_signature:
            raise ValueError("Invalid signature")

        # 1. Verify timestamp to prevent replay attacks
        try:
            ts = int(x_timestamp)
        except ValueError:
            raise ValueError("Invalid timestamp format")
            
        current_ts = int(time.time())
        if abs(current_ts - ts) > MAX_TIMESTAMP_DIFF:
            raise ValueError("Request timestamp expired or too far in future")

        # 2. Read and validate body payload details used in signature checks
        raw_body = await request.body()
        if not raw_body:
            raise ValueError("Missing request body")

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("Invalid JSON payload")

        payload_device_id = payload.get("device_id")
        if isinstance(payload_device_id, str) and payload_device_id.strip() and payload_device_id.strip() != normalized_device_id:
            raise ValueError("Device ID mismatch between header and payload")

        computed_body_hash = hashlib.sha256(raw_body).hexdigest()
        normalized_body_hash = x_body_hash.strip().lower() if x_body_hash else None

        if settings.device_api_require_body_hash_signature and not normalized_body_hash:
            raise ValueError("Missing X-Body-Hash header")

        if normalized_body_hash and not hmac.compare_digest(computed_body_hash, normalized_body_hash):
            raise ValueError("Invalid body hash")

        # 3. Verify signature (legacy: timestamp+device_id, hardened: +body_hash)
        expected_signature = _compute_signature(
            x_timestamp,
            normalized_device_id,
            body_hash=normalized_body_hash,
        )

        if not hmac.compare_digest(expected_signature, normalized_signature):
            raise ValueError("Invalid signature")

        request.state.device_request_timestamp = ts
        return True

    except ValueError as e:
        log_device_error(db, x_device_id, str(e), request)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(e)
        )
    except Exception as e:
        log_device_error(db, x_device_id, f"Unexpected security error: {str(e)}", request)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Security check failed"
        )

@router.post("/device/v1/pressure", response_model=PressureResponse, status_code=201)
@limiter.limit("60/minute")
def create_pressure_record(
    request: Request,
    *,
    db: Session = Depends(get_db),
    pressure_in: PressureCreate,
    authorized: bool = Depends(verify_device_signature)
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
            "patient_id": record.patient_id
        }
    except HTTPException as e:
        # Log known HTTP exceptions (like Patient not found)
        log_device_error(db, pressure_in.device_id, f"HTTP {e.status_code}: {e.detail}", request)
        raise e
    except Exception as e:
        # Log unexpected errors
        log_device_error(db, pressure_in.device_id, f"Internal Error: {str(e)}", request)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )

@router.post("/add_pressure", response_model=PressureResponse, status_code=201, deprecated=True)
@limiter.limit("60/minute")
def add_pressure_alias(
    request: Request,
    *,
    db: Session = Depends(get_db),
    pressure_in: PressureCreate,
    authorized: bool = Depends(verify_device_signature)
):
    """
    Alias for /device/v1/pressure for backward compatibility.
    """
    # Simply call the main logic
    return create_pressure_record(request=request, db=db, pressure_in=pressure_in, authorized=authorized)
