from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.enums import MeetingStatus


class MeetingBase(BaseModel):
    date_time: Optional[datetime] = None
    description: Optional[str] = Field(default=None, max_length=2000)
    doctor_id: Optional[UUID] = None
    note: Optional[str] = Field(default=None, max_length=5000)
    room: Optional[str] = Field(default=None, max_length=100)
    user_id: Optional[UUID] = None
    status: MeetingStatus = MeetingStatus.scheduled


class MeetingCreate(MeetingBase):
    date_time: datetime
    doctor_id: UUID
    user_id: UUID
    status: MeetingStatus = MeetingStatus.scheduled


class MeetingUpdate(BaseModel):
    date_time: Optional[datetime] = None
    description: Optional[str] = Field(default=None, max_length=2000)
    doctor_id: Optional[UUID] = None
    note: Optional[str] = Field(default=None, max_length=5000)
    room: Optional[str] = Field(default=None, max_length=100)
    user_id: Optional[UUID] = None
    status: Optional[MeetingStatus] = None
    reason: Optional[str] = Field(default=None, max_length=2000)


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


class MeetingRoomPresenceOut(BaseModel):
    state: str
    doctor_online: bool
    patient_online: bool
    doctor_joined_at: Optional[datetime] = None
    doctor_last_seen_at: Optional[datetime] = None
    doctor_left_at: Optional[datetime] = None
    patient_joined_at: Optional[datetime] = None
    patient_last_seen_at: Optional[datetime] = None
    patient_left_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class MeetingOut(MeetingBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
    reason: Optional[str] = None
    cancelled_at: Optional[datetime] = None
    cancelled_by: Optional[UUID] = None
    doctor: Optional[DoctorBrief] = None
    patient: Optional[PatientBrief] = None
    room_presence: Optional[MeetingRoomPresenceOut] = None

    model_config = {"from_attributes": True}


class MeetingListResponse(BaseModel):
    items: List[MeetingOut]
    page: int
    limit: int
    total: int
