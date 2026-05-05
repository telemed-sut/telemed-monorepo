import json
import logging
from datetime import datetime, timezone
from typing import Optional
from redis import Redis, from_url
from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

class RedisManager:
    _instance: Optional[Redis] = None

    @property
    def client(self) -> Redis:
        if self._instance is None:
            if not settings.redis_url:
                raise RuntimeError("REDIS_URL is not configured")
            self._instance = from_url(settings.redis_url, decode_responses=True)
        return self._instance

    def acquire_lock(self, resource: str, owner_id: str, ttl_seconds: int = 10) -> bool:
        """
        Acquire a distributed lock using SET NX.
        Returns True if successful, False otherwise.
        """
        key = f"telemed:lock:{resource}"
        # nx=True means 'Set if Not Exists'
        return bool(self.client.set(key, owner_id, ex=ttl_seconds, nx=True))

    def release_lock(self, resource: str, owner_id: str) -> None:
        """
        Release a lock only if the current owner matches.
        """
        key = f"telemed:lock:{resource}"
        current_owner = self.client.get(key)
        if current_owner == owner_id:
            self.client.delete(key)

    def set_device_presence(self, device_id: str, status: str = "online", ttl_seconds: int = 60) -> None:
        """
        Mark a device as present/online in Redis.
        """
        key = f"telemed:device:presence:{device_id}"
        self.client.set(key, status, ex=ttl_seconds)

    def get_device_presence(self, device_id: str) -> Optional[str]:
        """
        Check if a device is online.
        """
        key = f"telemed:device:presence:{device_id}"
        return self.client.get(key)

    def cache_active_session(self, patient_id: str, data: str, ttl_seconds: int = 3600) -> None:
        """
        Cache active session info for a patient.
        """
        key = f"telemed:cache:active_session:{patient_id}"
        self.client.set(key, data, ex=ttl_seconds)

    def get_cached_active_session(self, patient_id: str) -> Optional[str]:
        """
        Get cached active session info.
        """
        key = f"telemed:cache:active_session:{patient_id}"
        return self.client.get(key)

    def invalidate_active_session(self, patient_id: str) -> None:
        """
        Remove cached session info.
        """
        key = f"telemed:cache:active_session:{patient_id}"
        self.client.delete(key)

    def invalidate_device_cache(self, device_id: str) -> None:
        """
        Invalidate all caches related to a device.
        """
        pass

    def publish_patient_event(self, patient_id: str, event_type: str, data: dict) -> None:
        """
        Broadcast an event to all subscribers of a specific patient.
        """
        channel = f"telemed:stream:patient:{patient_id}"
        message = json.dumps({
            "type": event_type,
            "data": data,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        self.client.publish(channel, message)

redis_manager = RedisManager()
