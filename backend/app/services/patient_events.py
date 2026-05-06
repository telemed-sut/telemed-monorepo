import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from threading import RLock
from typing import Any
from uuid import UUID

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _PatientSubscriber:
    queue: asyncio.Queue[dict[str, Any]]
    loop: asyncio.AbstractEventLoop


class PatientEventHub:
    def __init__(self) -> None:
        self._lock = RLock()
        self._subscribers: dict[str, list[_PatientSubscriber]] = {}

    async def subscribe(self, patient_id: UUID | str) -> asyncio.Queue[dict[str, Any]]:
        patient_key = str(patient_id)
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=100)
        with self._lock:
            self._subscribers.setdefault(patient_key, []).append(
                _PatientSubscriber(queue=queue, loop=loop)
            )
        return queue

    async def unsubscribe(
        self,
        patient_id: UUID | str,
        queue: asyncio.Queue[dict[str, Any]],
    ) -> None:
        patient_key = str(patient_id)
        with self._lock:
            subscribers = self._subscribers.get(patient_key)
            if not subscribers:
                return
            subscribers[:] = [
                subscriber for subscriber in subscribers if subscriber.queue is not queue
            ]
            if not subscribers:
                self._subscribers.pop(patient_key, None)

    def publish_nowait(self, event: dict[str, Any]) -> None:
        patient_id = event.get("data", {}).get("patient_id")
        if not patient_id:
            logger.debug("Patient event missing patient_id; dropping event.")
            return

        with self._lock:
            subscribers = list(self._subscribers.get(str(patient_id), []))

        for subscriber in subscribers:
            if subscriber.loop.is_closed():
                continue
            subscriber.loop.call_soon_threadsafe(
                self._enqueue,
                subscriber.queue,
                event,
                str(patient_id),
            )

    async def publish(self, event: dict[str, Any]) -> None:
        self.publish_nowait(event)

    @staticmethod
    def _enqueue(
        queue: asyncio.Queue[dict[str, Any]],
        event: dict[str, Any],
        patient_id: str,
    ) -> None:
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            logger.debug(
                "Patient events queue full; dropping event.",
                extra={"patient_id": patient_id},
            )


patient_event_hub = PatientEventHub()


def build_patient_event(
    *,
    patient_id: UUID | str,
    event_type: str,
    recorded_at: datetime | None = None,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    occurred_at = recorded_at or datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "type": event_type,
        "data": {
            "patient_id": str(patient_id),
            "recorded_at": occurred_at.isoformat(),
        },
        "timestamp": occurred_at.isoformat(),
    }
    if data:
        payload["data"].update(data)
    return payload


async def publish_patient_event(
    *,
    patient_id: UUID | str,
    event_type: str,
    recorded_at: datetime | None = None,
    data: dict[str, Any] | None = None,
) -> None:
    await patient_event_hub.publish(
        build_patient_event(
            patient_id=patient_id,
            event_type=event_type,
            recorded_at=recorded_at,
            data=data,
        )
    )


def publish_patient_event_sync(
    *,
    patient_id: UUID | str,
    event_type: str,
    recorded_at: datetime | None = None,
    data: dict[str, Any] | None = None,
) -> None:
    patient_event_hub.publish_nowait(
        build_patient_event(
            patient_id=patient_id,
            event_type=event_type,
            recorded_at=recorded_at,
            data=data,
        )
    )
