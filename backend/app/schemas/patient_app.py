"""Pydantic schemas for patient mobile-app authentication."""

import re
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


_PIN_FORMAT_MESSAGE = (
    "PIN must be 4-6 digits. Registration codes such as HEBPD2 must be sent as "
    "code to /patient-app/register, not as pin to /patient-app/login."
)


def _validate_patient_pin(value: str) -> str:
    if not re.fullmatch(r"\d{4,6}", value or ""):
        raise ValueError(_PIN_FORMAT_MESSAGE)
    return value


# ---------- Registration code (care-team-facing) ----------

class PatientRegistrationCodeResponse(BaseModel):
    patient_id: UUID
    code: str = Field(
        description="One-time registration code generated from the doctor/admin web page.",
        examples=["HEBPD2"],
    )
    expires_at: datetime


# ---------- Patient app registration (patient-facing) ----------

class PatientAppRegisterRequest(BaseModel):
    phone: str = Field(
        min_length=8,
        max_length=50,
        description="Patient phone number as registered by the hospital.",
        examples=["0934456858"],
    )
    code: str = Field(
        min_length=4,
        max_length=10,
        description="Registration code generated from the doctor/admin web page. This is not the login PIN.",
        examples=["HEBPD2"],
    )
    pin: str = Field(
        description="New 4-6 digit numeric PIN chosen by the patient during registration.",
        examples=["123456"],
    )

    @field_validator("pin")
    @classmethod
    def validate_pin(cls, value: str) -> str:
        return _validate_patient_pin(value)

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "phone": "0934456858",
                "code": "HEBPD2",
                "pin": "123456",
            },
        },
    )


class PatientAppRegisterResponse(BaseModel):
    patient_id: UUID
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    patient_name: str


# ---------- Patient app login (patient-facing) ----------

class PatientAppLoginRequest(BaseModel):
    phone: str = Field(
        min_length=8,
        max_length=50,
        description="Patient phone number used during patient-app registration.",
        examples=["0934456858"],
    )
    pin: str = Field(
        description="4-6 digit numeric PIN set during registration. Do not use the registration code here.",
        examples=["123456"],
    )

    @field_validator("pin")
    @classmethod
    def validate_pin(cls, value: str) -> str:
        return _validate_patient_pin(value)

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "phone": "0934456858",
                "pin": "123456",
            },
        },
    )


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
    patient_invite_expires_at: Optional[datetime] = None
    doctor: Optional[PatientMeetingDoctorBrief] = None
    room_presence: Optional[PatientMeetingPresenceOut] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PatientMeetingListResponse(BaseModel):
    items: list[PatientMeetingOut]
    total: int
