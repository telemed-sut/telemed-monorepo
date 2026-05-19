import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List
from uuid import UUID

logger = logging.getLogger(__name__)


class UserEventHub:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._subscribers: List[asyncio.Queue[Dict[str, Any]]] = []

    async def subscribe(self) -> asyncio.Queue[Dict[str, Any]]:
        queue: asyncio.Queue[Dict[str, Any]] = asyncio.Queue(maxsize=100)
        async with self._lock:
            self._subscribers.append(queue)
        return queue

    async def unsubscribe(self, queue: asyncio.Queue[Dict[str, Any]]) -> None:
        async with self._lock:
            if queue in self._subscribers:
                self._subscribers.remove(queue)

    async def publish(self, event: Dict[str, Any]) -> None:
        async with self._lock:
            subscribers = list(self._subscribers)

        for queue in subscribers:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                logger.debug("User events queue full; dropping event.")


user_event_hub = UserEventHub()


def build_user_registered_event(user_id: UUID) -> Dict[str, Any]:
    return {
        "type": "user.registered",
        "user_id": str(user_id),
        "occurred_at": datetime.now(timezone.utc).isoformat(),
    }


async def publish_user_registered(user_id: UUID) -> None:
    await user_event_hub.publish(build_user_registered_event(user_id))
