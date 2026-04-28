import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List
from uuid import UUID

from app.services.redis_runtime import get_redis_client_or_log, log_redis_operation_failure

logger = logging.getLogger(__name__)
_USER_EVENTS_CHANNEL = "user_events:v1"
_REDIS_SCOPE = "user_events_pubsub"
_FALLBACK_LABEL = "in-memory delivery"


class UserEventHub:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._subscribers: List[asyncio.Queue[Dict[str, Any]]] = []
        self._redis_subscribers: dict[asyncio.Queue[Dict[str, Any]], tuple[Any, asyncio.Task[None]]] = {}

    async def subscribe(self) -> asyncio.Queue[Dict[str, Any]]:
        queue: asyncio.Queue[Dict[str, Any]] = asyncio.Queue(maxsize=100)
        async with self._lock:
            if not await self._attach_redis_subscription(queue):
                self._subscribers.append(queue)
        return queue

    async def unsubscribe(self, queue: asyncio.Queue[Dict[str, Any]]) -> None:
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
                    logger.debug("Failed to close Redis pubsub for user events.", exc_info=True)

    async def publish(self, event: Dict[str, Any]) -> None:
        delivered_via_redis = False
        redis_client = self._get_redis_client()
        if redis_client is not None:
            try:
                await asyncio.to_thread(
                    redis_client.publish,
                    _USER_EVENTS_CHANNEL,
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
                logger.debug("User events queue full; dropping event.")

    def _get_redis_client(self):
        return get_redis_client_or_log(
            logger,
            scope=_REDIS_SCOPE,
            fallback_label=_FALLBACK_LABEL,
        )

    async def _attach_redis_subscription(self, queue: asyncio.Queue[Dict[str, Any]]) -> bool:
        redis_client = self._get_redis_client()
        if redis_client is None:
            return False

        try:
            pubsub = redis_client.pubsub(ignore_subscribe_messages=True)
            await asyncio.to_thread(pubsub.subscribe, _USER_EVENTS_CHANNEL)
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
                logger.debug("Failed to close Redis pubsub after subscription error.", exc_info=True)
            return False

        task = asyncio.create_task(self._redis_listener(queue, pubsub))
        self._redis_subscribers[queue] = (pubsub, task)
        return True

    async def _redis_listener(self, queue: asyncio.Queue[Dict[str, Any]], pubsub: Any) -> None:
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
                    logger.debug("User events Redis listener dropped malformed payload.")
                    continue

                if not isinstance(event, dict):
                    continue

                try:
                    queue.put_nowait(event)
                except asyncio.QueueFull:
                    logger.debug("User events queue full; dropping Redis event.")
        except asyncio.CancelledError:
            raise


user_event_hub = UserEventHub()


def build_user_registered_event(user_id: UUID) -> Dict[str, Any]:
    return {
        "type": "user.registered",
        "user_id": str(user_id),
        "occurred_at": datetime.now(timezone.utc).isoformat(),
    }


async def publish_user_registered(user_id: UUID) -> None:
    await user_event_hub.publish(build_user_registered_event(user_id))
