import asyncio

import pytest

from app.services import user_events as user_events_module


class FakeRedisPubSub:
    def __init__(self, broker):
        self._broker = broker
        self._queue = asyncio.Queue()
        self.closed = False

    def subscribe(self, channel):
        self._broker.subscribe(channel, self)

    def get_message(self, timeout=1.0):
        try:
            return self._queue.get_nowait()
        except asyncio.QueueEmpty:
            return None

    def push(self, payload):
        self._queue.put_nowait({"type": "message", "data": payload})

    def close(self):
        self.closed = True
        self._broker.unsubscribe(self)


class FakeRedisBroker:
    def __init__(self):
        self.channels = {}

    def subscribe(self, channel, pubsub):
        self.channels.setdefault(channel, []).append(pubsub)

    def unsubscribe(self, pubsub):
        for subscribers in self.channels.values():
            while pubsub in subscribers:
                subscribers.remove(pubsub)

    def publish(self, channel, payload):
        for pubsub in list(self.channels.get(channel, [])):
            pubsub.push(payload)


class FakeRedisClient:
    def __init__(self, broker):
        self._broker = broker

    def pubsub(self, ignore_subscribe_messages=True):
        return FakeRedisPubSub(self._broker)

    def publish(self, channel, payload):
        self._broker.publish(channel, payload)
        return 1


class BrokenRedisClient:
    def pubsub(self, ignore_subscribe_messages=True):
        raise RuntimeError("redis unavailable")

    def publish(self, channel, payload):
        raise RuntimeError("redis unavailable")


@pytest.mark.anyio
async def test_user_event_hub_delivers_events_with_in_memory_fallback(monkeypatch):
    monkeypatch.setattr(user_events_module, "get_redis_client_or_log", lambda *args, **kwargs: None)
    hub = user_events_module.UserEventHub()

    queue = await hub.subscribe()
    try:
        payload = {"type": "user.registered", "user_id": "user-local"}
        await hub.publish(payload)
        received = await asyncio.wait_for(queue.get(), timeout=1)
        assert received == payload
    finally:
        await hub.unsubscribe(queue)


@pytest.mark.anyio
async def test_user_event_hub_delivers_events_via_redis_pubsub(monkeypatch):
    broker = FakeRedisBroker()
    monkeypatch.setattr(user_events_module, "get_redis_client_or_log", lambda *args, **kwargs: FakeRedisClient(broker))
    hub = user_events_module.UserEventHub()

    queue = await hub.subscribe()
    try:
        payload = {"type": "user.registered", "user_id": "user-redis"}
        await hub.publish(payload)
        received = await asyncio.wait_for(queue.get(), timeout=1)
        assert received == payload
    finally:
        await hub.unsubscribe(queue)


@pytest.mark.anyio
async def test_user_event_hub_falls_back_to_in_memory_when_redis_subscription_fails(monkeypatch):
    monkeypatch.setattr(user_events_module, "get_redis_client_or_log", lambda *args, **kwargs: BrokenRedisClient())
    hub = user_events_module.UserEventHub()

    queue = await hub.subscribe()
    try:
        payload = {"type": "user.registered", "user_id": "user-fallback"}
        await hub.publish(payload)
        received = await asyncio.wait_for(queue.get(), timeout=1)
        assert received == payload
    finally:
        await hub.unsubscribe(queue)
