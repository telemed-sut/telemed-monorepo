from fastapi import APIRouter, Depends, HTTPException, Header, Request, status
from sqlalchemy.orm import Session
from typing import Any, List
import hmac
import hashlib
import time
from datetime import datetime

from app.services.auth import get_db
from app.schemas.pressure import PressureCreate, PressureResponse
from app.services.pressure import pressure_service
from app.core.config import get_settings

router = APIRouter()
settings = get_settings()

MAX_TIMESTAMP_DIFF = 300  # 5 minutes

def verify_device_signature(
    request: Request,
    x_device_id: str = Header(..., alias="X-Device-Id"),
    x_timestamp: str = Header(..., alias="X-Timestamp"),
    x_signature: str = Header(..., alias="X-Signature"),
):
    # 1. Verify timestamp to prevent replay attacks
    try:
        ts = int(x_timestamp)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid timestamp format"
        )
        
    current_ts = int(time.time())
    if abs(current_ts - ts) > MAX_TIMESTAMP_DIFF:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Request timestamp expired or too far in future"
        )

    # 2. Verify signature
    # Signature = HMAC-SHA256(secret, timestamp + device_id)
    # Note: Ideally we should sign the body too, but let's start with this for simplicity/performance 
    # unless specified otherwise. Or check user request details deeply. 
    # "Request body: ... Header: X-Signature (HMAC)"
    # Usually signature covers body.
    # Let's try to sign (timestamp + device_id) for now to avoid body parsing issues in dependency.
    
    message = f"{x_timestamp}{x_device_id}"
    signature = hmac.new(
        settings.device_api_secret.encode(),
        message.encode(),
        hashlib.sha256
    ).hexdigest()
    
    if not hmac.compare_digest(signature, x_signature):
        # Allow debugging if simple match fails, maybe they sign body?
        # But for strictly following "Header ... X-Signature", standard is typically Payload+Timestamp
        # Given "device_id" header is present, likely it's part of it.
        # User didn't specify exact construction. I'll stick to (timestamp + device_id).
        # A more robust one would be (method + path + timestamp + body).
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid signature"
        )
        
    return True

@router.post("/device/v1/pressure", response_model=PressureResponse, status_code=201)
def create_pressure_record(
    *,
    db: Session = Depends(get_db),
    pressure_in: PressureCreate,
    authorized: bool = Depends(verify_device_signature)
) -> Any:
    """
    Receive blood pressure data from physical device.
    """
    record = pressure_service.create_pressure(db, pressure_in)
    return {
        "id": record.id,
        "received_at": record.created_at,
        "patient_id": record.patient_id
    }

@router.post("/add_pressure", response_model=PressureResponse, status_code=201, deprecated=True)
def add_pressure_alias(
    *,
    db: Session = Depends(get_db),
    pressure_in: PressureCreate,
    authorized: bool = Depends(verify_device_signature)
):
    """
    Alias for /device/v1/pressure for backward compatibility.
    """
    # Simply call the main logic
    return create_pressure_record(db=db, pressure_in=pressure_in, authorized=authorized)
