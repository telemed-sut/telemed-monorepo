from datetime import datetime

from pydantic import BaseModel


class AuditLogResponse(BaseModel):
    id: str
    user_id: str | None = None
    user_email: str | None = None
    user_name: str | None = None
    action: str
    result: str
    resource_type: str | None = None
    resource_id: str | None = None
    details: str | None = None
    ip_address: str | None = None
    is_break_glass: bool
    break_glass_reason: str | None = None
    old_values: dict | None = None
    new_values: dict | None = None
    created_at: datetime


class AuditLogListResponse(BaseModel):
    items: list[AuditLogResponse]
    page: int
    limit: int
    total: int
