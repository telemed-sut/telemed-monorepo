from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel

from app.models.enums import AlertCategory, AlertSeverity


class AlertOut(BaseModel):
    id: UUID
    patient_id: UUID
    severity: AlertSeverity
    category: AlertCategory
    title: str
    message: Optional[str] = None
    is_acknowledged: bool
    acknowledged_by: Optional[UUID] = None
    acknowledged_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AlertAcknowledge(BaseModel):
    reason: Optional[str] = None
