"""Pydantic schemas for the patient mobile-app heart/cardiology screens.

Field names mirror the mobile models in lib/models/heart_data.dart so the
existing parsers (`HeartProfile.fromJson`, `HeartAlert.fromJson`) work without
modification.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class HeartReadingPointOut(BaseModel):
    id: str
    heart_rate: Optional[int] = None
    systolic_bp: Optional[int] = None
    diastolic_bp: Optional[int] = None
    measured_at: datetime


class HeartProfileOut(BaseModel):
    patient_name: str
    risk_level: Optional[str] = None
    diagnosis: Optional[str] = None
    latest_heart_rate: Optional[int] = None
    latest_blood_pressure: Optional[str] = None
    last_checkup_at: Optional[datetime] = None
    medications: list[str]
    history: list[HeartReadingPointOut]


class HeartAlertOut(BaseModel):
    id: UUID
    severity: str
    title: str
    message: str
    is_read: bool
    occurred_at: datetime


class HeartAlertListResponse(BaseModel):
    recent: list[HeartAlertOut]
    history: list[HeartAlertOut]
