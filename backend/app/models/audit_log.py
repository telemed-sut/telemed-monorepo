import json
from typing import Any
from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text, event, func, text as sql_text
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.db.base import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    action = Column(String(100), nullable=False)
    resource_type = Column(String(100), nullable=True)
    resource_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    details = Column(JSONB, nullable=True)  # Migrating from Text to JSONB for indexing & fast read
    status = Column(
        String(20),
        nullable=False,
        index=True,
        default="success",
        server_default=sql_text("'success'"),
    )  # E.g., 'success', 'failure'
    ip_address = Column(String(45), nullable=True)
    is_break_glass = Column(Boolean, default=False, nullable=False)
    break_glass_reason = Column(Text, nullable=True)
    old_values = Column(JSONB, nullable=True)
    new_values = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)


_FAILURE_KEYWORDS = ("failed", "failure", "denied", "forbidden")


def _details_indicates_failure(details: Any) -> bool:
    if details is None:
        return False

    payload = details
    if isinstance(details, str):
        stripped = details.strip()
        if not stripped:
            return False
        try:
            payload = json.loads(stripped)
        except json.JSONDecodeError:
            return False

    if not isinstance(payload, dict):
        return False

    success = payload.get("success")
    if success is False:
        return True
    if isinstance(success, str) and success.strip().lower() == "false":
        return True
    return payload.get("error") is not None


@event.listens_for(AuditLog, "before_insert")
def _assign_inferred_status(_mapper, _connection, target: AuditLog) -> None:
    if target.status:
        return

    action = (target.action or "").lower()
    if any(keyword in action for keyword in _FAILURE_KEYWORDS) or _details_indicates_failure(target.details):
        target.status = "failure"
    else:
        target.status = "success"
