import asyncio
import json
from datetime import datetime, timezone
from typing import AsyncIterator, Dict

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.models.user import User
from app.services.auth import get_admin_user
from app.services.user_events import user_event_hub

router = APIRouter(prefix="/events", tags=["events"])


def _format_sse(event: str, data: Dict) -> str:
    payload = json.dumps(data, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n"


async def _user_event_stream(request: Request) -> AsyncIterator[str]:
    queue = await user_event_hub.subscribe()
    try:
        yield _format_sse(
            "ready",
            {"occurred_at": datetime.now(timezone.utc).isoformat()},
        )
        while True:
            if await request.is_disconnected():
                break
            try:
                event = await asyncio.wait_for(queue.get(), timeout=15)
            except asyncio.TimeoutError:
                yield _format_sse(
                    "heartbeat",
                    {"occurred_at": datetime.now(timezone.utc).isoformat()},
                )
                continue

            event_type = event.get("type", "message")
            yield _format_sse(event_type, event)
    finally:
        await user_event_hub.unsubscribe(queue)


@router.get("/users")
async def stream_user_events(
    request: Request,
    current_user: User = Depends(get_admin_user),
):
    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(
        _user_event_stream(request),
        headers=headers,
        media_type="text/event-stream",
    )
