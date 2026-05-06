import asyncio

import pytest

from app.services import user_events as user_events_module


@pytest.mark.anyio
async def test_user_event_hub_delivers_events_in_memory():
    hub = user_events_module.UserEventHub()

    queue = await hub.subscribe()
    try:
        payload = {"type": "user.registered", "user_id": "user-local"}
        await hub.publish(payload)
        received = await asyncio.wait_for(queue.get(), timeout=1)
        assert received == payload
    finally:
        await hub.unsubscribe(queue)
