import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from app.models.device_exam_session import DeviceExamSession

logger = logging.getLogger(__name__)


class DeviceSessionEventHub:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._subscribers: list[asyncio.Queue[dict[str, Any]]] = []

    async def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=100)
        async with self._lock:
            self._subscribers.append(queue)
        return queue

    async def unsubscribe(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        async with self._lock:
            if queue in self._subscribers:
                self._subscribers.remove(queue)

    async def publish(self, event: dict[str, Any]) -> None:
        async with self._lock:
            subscribers = list(self._subscribers)

        for queue in subscribers:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                logger.debug("Device session events queue full; dropping event.")


device_session_event_hub = DeviceSessionEventHub()


def build_device_session_event(
    *,
    event_type: str,
    session: DeviceExamSession,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = {
        "type": event_type,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "session_id": str(session.id),
        "device_id": session.device_id,
        "patient_id": str(session.patient_id),
        "status": session.status.value,
        "resolution_reason": session.resolution_reason.value if session.resolution_reason else None,
        "measurement_type": session.measurement_type.value,
        "last_seen_at": session.last_seen_at.isoformat() if session.last_seen_at else None,
    }
    if extra:
        payload.update(extra)
    return payload


async def publish_device_session_event(
    *,
    event_type: str,
    session: DeviceExamSession,
    extra: dict[str, Any] | None = None,
) -> None:
    await device_session_event_hub.publish(
        build_device_session_event(event_type=event_type, session=session, extra=extra)
    )


def publish_device_session_event_sync(
    *,
    event_type: str,
    session: DeviceExamSession,
    extra: dict[str, Any] | None = None,
) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        asyncio.run(
            publish_device_session_event(
                event_type=event_type,
                session=session,
                extra=extra,
            )
        )
        return

    loop.create_task(
        publish_device_session_event(
            event_type=event_type,
            session=session,
            extra=extra,
        )
    )
