from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel

from app.models.enums import EncounterStatus, EncounterType


class EncounterCreate(BaseModel):
    patient_id: UUID
    encounter_type: EncounterType
    ward: Optional[str] = None
    bed_number: Optional[str] = None
    attending_doctor_id: Optional[UUID] = None
    chief_complaint: Optional[str] = None


class EncounterUpdate(BaseModel):
    status: Optional[EncounterStatus] = None
    ward: Optional[str] = None
    bed_number: Optional[str] = None
    attending_doctor_id: Optional[UUID] = None
    discharge_summary: Optional[str] = None
    discharged_at: Optional[datetime] = None


class EncounterOut(BaseModel):
    id: UUID
    patient_id: UUID
    encounter_type: EncounterType
    status: EncounterStatus
    admitted_at: datetime
    discharged_at: Optional[datetime] = None
    ward: Optional[str] = None
    bed_number: Optional[str] = None
    attending_doctor_id: Optional[UUID] = None
    chief_complaint: Optional[str] = None
    discharge_summary: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
