import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.pressure import log_device_error, verify_device_signature
from app.core.limiter import get_device_ingest_rate_limit_key, limiter
from app.schemas.lung_sound import LungSoundCreate, LungSoundIngestResponse
from app.services.auth import get_db
from app.services.lung_sound import lung_sound_service

router = APIRouter()


@router.post("/device/v1/lung-sounds", response_model=LungSoundIngestResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("60/minute", key_func=get_device_ingest_rate_limit_key)
def create_lung_sound_record(
    request: Request,
    *,
    db: Session = Depends(get_db),
    lung_sound_in: LungSoundCreate,
    _authorized: bool = Depends(verify_device_signature),
) -> Any:
    try:
        if lung_sound_in.recorded_at is None:
            signed_ts = getattr(request.state, "device_request_timestamp", int(time.time()))
            lung_sound_in = lung_sound_in.model_copy(
                update={"recorded_at": datetime.fromtimestamp(signed_ts, tz=timezone.utc)}
            )

        record = lung_sound_service.create_lung_sound(db, lung_sound_in)
        return {"status": "ok", "record_id": record.id}
    except HTTPException as exc:
        log_device_error(db, lung_sound_in.device_id, f"HTTP {exc.status_code}", request)
        raise
    except Exception as exc:
        log_device_error(db, lung_sound_in.device_id, f"INTERNAL_ERROR:{exc.__class__.__name__}", request)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error",
        )
