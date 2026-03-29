import time
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.pressure import log_device_error, verify_device_signature
from app.core.limiter import limiter
from app.core.request_utils import get_client_ip
from app.models.user import User
from app.schemas.heart_sound import HeartSoundCreate, HeartSoundIngestResponse, HeartSoundListResponse
from app.services import audit as audit_service
from app.services.auth import get_db, verify_patient_access
from app.services.heart_sound import heart_sound_service

router = APIRouter()


@router.post("/device/v1/heart-sounds", response_model=HeartSoundIngestResponse, status_code=201)
@limiter.limit("60/minute")
def create_heart_sound_record(
    request: Request,
    *,
    db: Session = Depends(get_db),
    heart_sound_in: HeartSoundCreate,
    authorized: bool = Depends(verify_device_signature),
) -> Any:
    try:
        if heart_sound_in.recorded_at is None:
            signed_ts = getattr(request.state, "device_request_timestamp", int(time.time()))
            heart_sound_in = heart_sound_in.model_copy(
                update={"recorded_at": datetime.fromtimestamp(signed_ts, tz=timezone.utc)}
            )

        device_id = (request.headers.get("x-device-id") or "").strip()
        if not device_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Missing X-Device-Id header",
            )

        record = heart_sound_service.create_heart_sound(
            db,
            payload=heart_sound_in,
            device_id=device_id,
        )
        return {"status": "ok", "record_id": record.id}
    except HTTPException as exc:
        log_device_error(
            db,
            (request.headers.get("x-device-id") or "unknown"),
            f"HTTP {exc.status_code}: {exc.detail}",
            request,
        )
        raise
    except Exception as exc:
        log_device_error(
            db,
            (request.headers.get("x-device-id") or "unknown"),
            f"Internal Error: {str(exc)}",
            request,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error",
        )


@router.get("/patients/{patient_id}/heart-sounds", response_model=HeartSoundListResponse)
@limiter.limit("60/minute")
def get_patient_heart_sounds(
    request: Request,
    patient_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(verify_patient_access),
):
    items = heart_sound_service.list_patient_heart_sounds(db, patient_id)
    audit_service.log_action(
        db,
        current_user.id,
        "view_patient_heart_sounds",
        resource_type="patient",
        resource_id=patient_id,
        ip_address=get_client_ip(request),
        details={"count": len(items)},
    )
    return {"items": items}
