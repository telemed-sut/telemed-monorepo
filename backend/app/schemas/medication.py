from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel

from app.models.enums import OrderStatus


class MedicationCreate(BaseModel):
    patient_id: UUID
    name: str
    dosage: Optional[str] = None
    frequency: Optional[str] = None
    route: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    notes: Optional[str] = None


class MedicationUpdate(BaseModel):
    status: Optional[OrderStatus] = None
    dosage: Optional[str] = None
    frequency: Optional[str] = None
    end_date: Optional[datetime] = None
    notes: Optional[str] = None


class MedicationOut(BaseModel):
    id: UUID
    patient_id: UUID
    name: str
    dosage: Optional[str] = None
    frequency: Optional[str] = None
    route: Optional[str] = None
    status: OrderStatus
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    ordered_by: Optional[UUID] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
