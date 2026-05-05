import logging
from threading import Lock
from typing import Optional

logger = logging.getLogger(__name__)

class RedisManager:
    _locks: set[str]
    _lock: Lock

    def __init__(self) -> None:
        self._locks = set()
        self._lock = Lock()

    @property
    def client(self):
        raise RuntimeError("Redis has been removed from the application runtime.")

    def acquire_lock(self, resource: str, owner_id: str, ttl_seconds: int = 10) -> bool:
        """
        Acquire a distributed lock using SET NX.
        Returns True if successful, False otherwise.
        """
        key = f"{resource}:{owner_id}"
        with self._lock:
            if key in self._locks:
                return False
            self._locks.add(key)
            return True

    def release_lock(self, resource: str, owner_id: str) -> None:
        """
        Release a lock only if the current owner matches.
        """
        key = f"{resource}:{owner_id}"
        with self._lock:
            self._locks.discard(key)

    def set_device_presence(self, device_id: str, status: str = "online", ttl_seconds: int = 60) -> None:
        """
        Mark a device as present/online in Redis.
        """
        return None

    def get_device_presence(self, device_id: str) -> Optional[str]:
        """
        Check if a device is online.
        """
        return None

    def cache_active_session(self, patient_id: str, data: str, ttl_seconds: int = 3600) -> None:
        """
        Cache active session info for a patient.
        """
        return None

    def get_cached_active_session(self, patient_id: str) -> Optional[str]:
        """
        Get cached active session info.
        """
        return None

    def invalidate_active_session(self, patient_id: str) -> None:
        """
        Remove cached session info.
        """
        return None

    def invalidate_device_cache(self, device_id: str) -> None:
        """
        Invalidate all caches related to a device.
        """
        pass

    def publish_patient_event(self, patient_id: str, event_type: str, data: dict) -> None:
        """
        Broadcast an event to all subscribers of a specific patient.
        """
        logger.debug(
            "Patient event publish skipped because Redis has been removed.",
            extra={"patient_id": patient_id, "event_type": event_type},
        )

redis_manager = RedisManager()
