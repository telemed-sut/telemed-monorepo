from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel

from app.models.enums import TimelineEventType


class TimelineEventOut(BaseModel):
    id: UUID
    patient_id: UUID
    event_type: TimelineEventType
    event_time: datetime
    title: str
    summary: Optional[str] = None
    details: Optional[str] = None
    is_abnormal: bool
    author_id: Optional[UUID] = None
    author_name: Optional[str] = None
    reference_id: Optional[UUID] = None
    reference_type: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class TimelineListResponse(BaseModel):
    items: list[TimelineEventOut]
    next_cursor: Optional[str] = None
    has_more: bool
