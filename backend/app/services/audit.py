import logging
from datetime import UTC, datetime
from typing import Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.core.logging_config import redact_sensitive_data


logger = logging.getLogger(__name__)


def _audit_log_payload(entry: AuditLog) -> dict[str, str | None]:
    created_at = entry.created_at
    if isinstance(created_at, datetime):
        timestamp = created_at.astimezone(UTC).isoformat()
    else:
        timestamp = datetime.now(UTC).isoformat()

    return {
        "event_type": "audit_log",
        "action": entry.action,
        "user_id": str(entry.user_id) if entry.user_id else None,
        "resource_type": entry.resource_type,
        "resource_id": str(entry.resource_id) if entry.resource_id else None,
        "ip_address": entry.ip_address,
        "status": entry.status,
        "timestamp": timestamp,
    }


def log_action(
    db: Session,
    user_id: UUID,
    action: str,
    resource_type: Optional[str] = None,
    resource_id: Optional[UUID] = None,
    details: Optional[str | dict] = None,
    ip_address: Optional[str] = None,
    is_break_glass: bool = False,
    break_glass_reason: Optional[str] = None,
    old_values: Optional[dict] = None,
    new_values: Optional[dict] = None,
    status: str = "success",
    *,
    commit: bool = True,
) -> AuditLog:
    """Write an entry to the audit log."""
    # Scrub sensitive data before persisting to DB
    scrubbed_details = redact_sensitive_data(details) if details else None
    scrubbed_old = redact_sensitive_data(old_values) if old_values else None
    scrubbed_new = redact_sensitive_data(new_values) if new_values else None

    entry = AuditLog(
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details=scrubbed_details,
        ip_address=ip_address,
        is_break_glass=is_break_glass,
        break_glass_reason=break_glass_reason,
        old_values=scrubbed_old,
        new_values=scrubbed_new,
        status=status,
    )
    db.add(entry)
    if commit:
        db.commit()
        db.refresh(entry)
    else:
        db.flush()
    logger.info("audit_log_event", extra=_audit_log_payload(entry))
    return entry
