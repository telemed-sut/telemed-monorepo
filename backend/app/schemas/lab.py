from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel

from app.models.enums import OrderStatus


class LabCreate(BaseModel):
    patient_id: UUID
    test_name: str
    category: Optional[str] = None
    notes: Optional[str] = None


class LabUpdate(BaseModel):
    status: Optional[OrderStatus] = None
    result_value: Optional[str] = None
    result_unit: Optional[str] = None
    reference_range: Optional[str] = None
    is_abnormal: Optional[bool] = None
    resulted_at: Optional[datetime] = None
    notes: Optional[str] = None


class LabOut(BaseModel):
    id: UUID
    patient_id: UUID
    test_name: str
    category: Optional[str] = None
    status: OrderStatus
    ordered_at: datetime
    resulted_at: Optional[datetime] = None
    result_value: Optional[str] = None
    result_unit: Optional[str] = None
    reference_range: Optional[str] = None
    is_abnormal: bool
    ordered_by: Optional[UUID] = None
    notes: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}
