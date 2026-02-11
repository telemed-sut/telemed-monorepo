from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class MeetingBase(BaseModel):
    date_time: Optional[datetime] = None
    description: Optional[str] = Field(default=None, max_length=2000)
    doctor_id: Optional[UUID] = None
    note: Optional[str] = Field(default=None, max_length=5000)
    room: Optional[str] = Field(default=None, max_length=100)
    user_id: Optional[UUID] = None


class MeetingCreate(MeetingBase):
    date_time: datetime
    doctor_id: UUID
    user_id: UUID


class MeetingUpdate(BaseModel):
    date_time: Optional[datetime] = None
    description: Optional[str] = Field(default=None, max_length=2000)
    doctor_id: Optional[UUID] = None
    note: Optional[str] = Field(default=None, max_length=5000)
    room: Optional[str] = Field(default=None, max_length=100)
    user_id: Optional[UUID] = None


class DoctorBrief(BaseModel):
    id: UUID
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None

    model_config = {"from_attributes": True}


class PatientBrief(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    people_id: Optional[str] = None

    model_config = {"from_attributes": True}


class MeetingOut(MeetingBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
    doctor: Optional[DoctorBrief] = None
    patient: Optional[PatientBrief] = None

    model_config = {"from_attributes": True}


class MeetingListResponse(BaseModel):
    items: List[MeetingOut]
    page: int
    limit: int
    total: int
