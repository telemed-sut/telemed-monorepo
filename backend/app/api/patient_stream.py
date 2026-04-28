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
    async def event_generator() -> AsyncGenerator[dict, None]:
        # Connect to Redis Pub/Sub
        pubsub = redis_manager.client.pubsub()
        channel = f"telemed:stream:patient:{patient_id}"
        pubsub.subscribe(channel)
        
        logger.info(f"Client connected to stream: {channel}")

        try:
            while True:
                # Check if client is still connected
                if await request.is_disconnected():
                    logger.info(f"Client disconnected from stream: {channel}")
                    break

                # Get message from Redis
                message = pubsub.get_message(ignore_subscribe_none=True, timeout=1.0)
                if message and message["type"] == "message":
                    yield {
                        "event": "message",
                        "data": message["data"]
                    }
                
                # Keep-alive heartbeat (optional)
                await asyncio.sleep(0.01)
        except Exception as e:
            logger.error(f"Stream error: {e}")
        finally:
            pubsub.unsubscribe(channel)
            pubsub.close()

    return EventSourceResponse(event_generator())
