import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

from app.models.device_exam_session import DeviceExamSession
from app.services.redis_runtime import get_redis_client_or_log, log_redis_operation_failure

logger = logging.getLogger(__name__)
_DEVICE_SESSION_EVENTS_CHANNEL = "device_session_events:v1"
_REDIS_SCOPE = "device_session_events_pubsub"
_FALLBACK_LABEL = "in-memory delivery"


class DeviceSessionEventHub:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._subscribers: list[asyncio.Queue[dict[str, Any]]] = []
        self._redis_subscribers: dict[asyncio.Queue[dict[str, Any]], tuple[Any, asyncio.Task[None]]] = {}

    async def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=100)
        async with self._lock:
            if not await self._attach_redis_subscription(queue):
                self._subscribers.append(queue)
        return queue

    async def unsubscribe(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        redis_subscription: tuple[Any, asyncio.Task[None]] | None = None
        async with self._lock:
            if queue in self._subscribers:
                self._subscribers.remove(queue)
            redis_subscription = self._redis_subscribers.pop(queue, None)

        if redis_subscription is not None:
            pubsub, task = redis_subscription
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            finally:
                try:
                    await asyncio.to_thread(pubsub.close)
                except Exception:
                    logger.debug("Failed to close Redis pubsub for device session events.", exc_info=True)

    async def publish(self, event: dict[str, Any]) -> None:
        delivered_via_redis = False
        redis_client = self._get_redis_client()
        if redis_client is not None:
            try:
                await asyncio.to_thread(
                    redis_client.publish,
                    _DEVICE_SESSION_EVENTS_CHANNEL,
                    json.dumps(event, separators=(",", ":")),
                )
                delivered_via_redis = True
            except Exception:
                log_redis_operation_failure(
                    logger,
                    scope=_REDIS_SCOPE,
                    operation="publish",
                    fallback_label=_FALLBACK_LABEL,
                )

        if delivered_via_redis:
            return

        async with self._lock:
            subscribers = list(self._subscribers)

        for queue in subscribers:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                logger.debug("Device session events queue full; dropping event.")

    def _get_redis_client(self):
        return get_redis_client_or_log(
            logger,
            scope=_REDIS_SCOPE,
            fallback_label=_FALLBACK_LABEL,
        )

    async def _attach_redis_subscription(self, queue: asyncio.Queue[dict[str, Any]]) -> bool:
        redis_client = self._get_redis_client()
        if redis_client is None:
            return False

        try:
            pubsub = redis_client.pubsub(ignore_subscribe_messages=True)
            await asyncio.to_thread(pubsub.subscribe, _DEVICE_SESSION_EVENTS_CHANNEL)
        except Exception:
            log_redis_operation_failure(
                logger,
                scope=_REDIS_SCOPE,
                operation="subscribe",
                fallback_label=_FALLBACK_LABEL,
            )
            try:
                await asyncio.to_thread(pubsub.close)  # type: ignore[name-defined]
            except Exception:
                logger.debug("Failed to close Redis pubsub after device session subscription error.", exc_info=True)
            return False

        task = asyncio.create_task(self._redis_listener(queue, pubsub))
        self._redis_subscribers[queue] = (pubsub, task)
        return True

    async def _redis_listener(self, queue: asyncio.Queue[dict[str, Any]], pubsub: Any) -> None:
        try:
            while True:
                try:
                    message = await asyncio.to_thread(pubsub.get_message, timeout=1.0)
                except Exception:
                    log_redis_operation_failure(
                        logger,
                        scope=_REDIS_SCOPE,
                        operation="listen",
                        fallback_label=_FALLBACK_LABEL,
                    )
                    return

                if not message:
                    await asyncio.sleep(0.05)
                    continue

                payload = message.get("data")
                if isinstance(payload, bytes):
                    payload = payload.decode("utf-8")
                if not isinstance(payload, str) or not payload:
                    continue

                try:
                    event = json.loads(payload)
                except json.JSONDecodeError:
                    logger.debug("Device session Redis listener dropped malformed payload.")
                    continue

                if not isinstance(event, dict):
                    continue

                try:
                    queue.put_nowait(event)
                except asyncio.QueueFull:
                    logger.debug("Device session events queue full; dropping Redis event.")
        except asyncio.CancelledError:
            raise


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
