"""Pydantic schemas for patient mobile-app authentication."""

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ---------- Registration code (staff-facing) ----------

class PatientRegistrationCodeResponse(BaseModel):
    patient_id: UUID
    code: str
    expires_at: datetime


# ---------- Patient app registration (patient-facing) ----------

class PatientAppRegisterRequest(BaseModel):
    phone: str = Field(min_length=8, max_length=50, description="Patient phone number as registered by the hospital.")
    code: str = Field(min_length=4, max_length=10, description="6-character registration code given by staff.")
    pin: str = Field(min_length=4, max_length=6, pattern=r"^\d{4,6}$", description="4-6 digit PIN chosen by the patient.")


class PatientAppRegisterResponse(BaseModel):
    patient_id: UUID
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    patient_name: str


# ---------- Patient app login (patient-facing) ----------

class PatientAppLoginRequest(BaseModel):
    phone: str = Field(min_length=8, max_length=50)
    pin: str = Field(min_length=4, max_length=6, pattern=r"^\d{4,6}$")


class PatientAppLoginResponse(BaseModel):
    patient_id: UUID
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    patient_name: str


# ---------- My meetings (patient-facing) ----------

class PatientMeetingDoctorBrief(BaseModel):
    id: UUID
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None

    model_config = {"from_attributes": True}


class PatientMeetingPresenceOut(BaseModel):
    state: str
    doctor_online: bool
    patient_online: bool
    doctor_last_seen_at: Optional[datetime] = None
    patient_last_seen_at: Optional[datetime] = None
    doctor_left_at: Optional[datetime] = None
    patient_left_at: Optional[datetime] = None
    refreshed_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class PatientMeetingOut(BaseModel):
    id: UUID
    date_time: Optional[datetime] = None
    description: Optional[str] = None
    status: str
    note: Optional[str] = None
    patient_invite_url: Optional[str] = None
    doctor: Optional[PatientMeetingDoctorBrief] = None
    room_presence: Optional[PatientMeetingPresenceOut] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class PatientMeetingListResponse(BaseModel):
    items: list[PatientMeetingOut]
    total: int
