from typing import Any
from datetime import datetime

from pydantic import BaseModel


class AuditLogResponse(BaseModel):
    id: str
    user_id: str | None = None
    user_email: str | None = None
    user_name: str | None = None
    action: str
    status: str
    resource_type: str | None = None
    resource_id: str | None = None
    details: Any | None = None
    ip_address: str | None = None
    is_break_glass: bool
    break_glass_reason: str | None = None
    old_values: Any | None = None
    new_values: Any | None = None
    created_at: datetime


class AuditLogListResponse(BaseModel):
    items: list[AuditLogResponse]
    limit: int
    next_cursor: str | None = None
