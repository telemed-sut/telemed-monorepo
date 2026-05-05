import asyncio
import json
import logging
from typing import AsyncGenerator
from uuid import UUID
from fastapi import APIRouter, Depends, Request
from sse_starlette.sse import EventSourceResponse

from app.services.auth import get_db, verify_patient_access
from app.services.redis import redis_manager
from app.models.user import User

router = APIRouter()
logger = logging.getLogger(__name__)

@router.get("/patients/{patient_id}/stream")
async def stream_patient_events(
    request: Request,
    patient_id: UUID,
    current_user: User = Depends(verify_patient_access),
):
    """
    Server-Sent Events (SSE) endpoint for real-time patient updates.
    """
    channel = f"telemed:stream:patient:{patient_id}"
    pubsub = redis_manager.client.pubsub(ignore_subscribe_messages=True)
    await asyncio.to_thread(pubsub.subscribe, channel)
    logger.info(f"Client connected to stream: {channel}")

    async def event_generator() -> AsyncGenerator[dict, None]:
        try:
            while True:
                if await request.is_disconnected():
                    logger.info(f"Client disconnected from stream: {channel}")
                    break

                # redis-py is synchronous — running it on the event loop would
                # block every other request for `timeout` seconds. Offload it.
                message = await asyncio.to_thread(
                    pubsub.get_message,
                    ignore_subscribe_messages=True,
                    timeout=1.0,
                )
                if message and message.get("type") == "message":
                    yield {"event": "message", "data": message["data"]}
        except Exception as e:
            logger.error(f"Stream error: {e}")
        finally:
            try:
                await asyncio.to_thread(pubsub.unsubscribe, channel)
                await asyncio.to_thread(pubsub.close)
            except Exception:
                logger.debug("pubsub cleanup failed", exc_info=True)

    return EventSourceResponse(event_generator())
