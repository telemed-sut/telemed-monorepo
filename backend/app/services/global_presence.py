import logging
import time
from typing import List

logger = logging.getLogger(__name__)

PRESENCE_SET_KEY = "presence:online_users:v1"
PRESENCE_TIMEOUT_SECONDS = 60
_presence_state: dict[str, int] = {}


def touch_global_presence(user_id: str) -> None:
    """Update a user's online status in the global presence index."""
    now = int(time.time())
    _presence_state[user_id] = now
    if now % 10 == 0:
        cleanup_expired_presence()

def cleanup_expired_presence() -> int:
    """Remove users who haven't sent a heartbeat within the timeout window."""
    timeout_threshold = int(time.time()) - PRESENCE_TIMEOUT_SECONDS
    expired = [user_id for user_id, last_seen in _presence_state.items() if last_seen < timeout_threshold]
    for user_id in expired:
        _presence_state.pop(user_id, None)
    return len(expired)

def get_online_user_ids() -> List[str]:
    """Get a list of currently active user IDs."""
    timeout_threshold = int(time.time()) - PRESENCE_TIMEOUT_SECONDS
    return [user_id for user_id, last_seen in _presence_state.items() if last_seen >= timeout_threshold]

def is_user_online(user_id: str) -> bool:
    """Check if a specific user is currently considered online."""
    score = _presence_state.get(user_id)
    if score is None:
        return False

    timeout_threshold = int(time.time()) - PRESENCE_TIMEOUT_SECONDS
    return score >= timeout_threshold
