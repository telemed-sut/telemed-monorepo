import asyncio
import json
import logging
from datetime import datetime
from typing import AsyncGenerator
from uuid import UUID
from fastapi import APIRouter, Depends, Request
from sse_starlette.sse import EventSourceResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.patient_screening import PatientScreening
from app.models.pressure_record import PressureRecord
from app.models.weight_record import WeightRecord
from app.services.auth import get_db, verify_patient_access
from app.models.user import User

router = APIRouter()
logger = logging.getLogger(__name__)
_SSE_KEEPALIVE_SECONDS = 20.0
_SSE_DB_POLL_SECONDS = 1.0
_FALLBACK_EVENT_BY_FIELD = {
    "pressure_measured_at": "new_pressure_reading",
    "weight_measured_at": "new_weight_record",
    "screening_recorded_at": "new_patient_screening",
}


def _fetch_patient_update_snapshot(
    db: Session,
    patient_id: UUID,
) -> dict[str, datetime | None]:
    return {
        "pressure_measured_at": db.scalar(
            select(func.max(PressureRecord.measured_at)).where(
                PressureRecord.patient_id == patient_id,
            )
        ),
        "weight_measured_at": db.scalar(
            select(func.max(WeightRecord.measured_at)).where(
                WeightRecord.patient_id == patient_id,
            )
        ),
        "screening_recorded_at": db.scalar(
            select(func.max(PatientScreening.recorded_at)).where(
                PatientScreening.patient_id == patient_id,
            )
        ),
    }


def _build_patient_stream_event(
    *,
    patient_id: UUID,
    event_type: str,
    recorded_at: datetime,
) -> str:
    return json.dumps(
        {
            "type": event_type,
            "data": {
                "patient_id": str(patient_id),
                "recorded_at": recorded_at.isoformat(),
            },
            "timestamp": recorded_at.isoformat(),
        }
    )

@router.get("/patients/{patient_id}/stream")
async def stream_patient_events(
    request: Request,
    patient_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(verify_patient_access),
):
    """
    Server-Sent Events (SSE) endpoint for real-time patient updates.
    """
    logger.info("Client connected to DB-backed patient stream: %s", patient_id)

    async def event_generator() -> AsyncGenerator[dict, None]:
        last_keepalive = asyncio.get_event_loop().time()
        fallback_snapshot = _fetch_patient_update_snapshot(db, patient_id)
        try:
            yield {"comment": "patient stream connected"}

            while True:
                if await request.is_disconnected():
                    logger.info("Client disconnected from patient stream: %s", patient_id)
                    break

                await asyncio.sleep(_SSE_DB_POLL_SECONDS)
                latest_snapshot = _fetch_patient_update_snapshot(db, patient_id)
                for field_name, latest_timestamp in latest_snapshot.items():
                    previous_timestamp = fallback_snapshot.get(field_name)
                    if latest_timestamp is None or latest_timestamp == previous_timestamp:
                        continue
                    yield {
                        "event": "message",
                        "data": _build_patient_stream_event(
                            patient_id=patient_id,
                            event_type=_FALLBACK_EVENT_BY_FIELD[field_name],
                            recorded_at=latest_timestamp,
                        ),
                    }
                    last_keepalive = asyncio.get_event_loop().time()
                fallback_snapshot = latest_snapshot

                now = asyncio.get_event_loop().time()
                if now - last_keepalive >= _SSE_KEEPALIVE_SECONDS:
                    yield {"comment": "keepalive"}
                    last_keepalive = now
        finally:
            logger.debug("Patient stream closed", extra={"patient_id": str(patient_id)})

    return EventSourceResponse(event_generator())
