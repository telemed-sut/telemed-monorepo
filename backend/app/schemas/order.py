from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel

from app.models.enums import OrderType


class OrderCreate(BaseModel):
    order_type: OrderType
    name: str
    dosage: Optional[str] = None
    frequency: Optional[str] = None
    route: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None
    start_date: Optional[datetime] = None


class NoteCreate(BaseModel):
    note_type: str = "soap"
    subjective: Optional[str] = None
    objective: Optional[str] = None
    assessment: Optional[str] = None
    plan: Optional[str] = None
    title: Optional[str] = None
