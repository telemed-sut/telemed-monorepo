from datetime import date, datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel

from app.models.enums import (
    AlertSeverity,
    EncounterStatus,
    EncounterType,
    OrderStatus,
)


class PatientHeaderOut(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    date_of_birth: date
    age: Optional[int] = None
    gender: Optional[str] = None
    allergies: Optional[str] = None
    blood_group: Optional[str] = None
    risk_score: Optional[int] = None
    primary_diagnosis: Optional[str] = None
    ward: Optional[str] = None
    bed_number: Optional[str] = None
    people_id: Optional[str] = None

    model_config = {"from_attributes": True}


class ActiveEncounterBrief(BaseModel):
    id: UUID
    encounter_type: EncounterType
    status: EncounterStatus
    admitted_at: datetime
    ward: Optional[str] = None
    bed_number: Optional[str] = None
    chief_complaint: Optional[str] = None

    model_config = {"from_attributes": True}


class ActiveMedicationBrief(BaseModel):
    id: UUID
    name: str
    dosage: Optional[str] = None
    frequency: Optional[str] = None
    route: Optional[str] = None
    status: OrderStatus

    model_config = {"from_attributes": True}


class PendingLabBrief(BaseModel):
    id: UUID
    test_name: str
    category: Optional[str] = None
    status: OrderStatus
    ordered_at: datetime

    model_config = {"from_attributes": True}


class ActiveAlertBrief(BaseModel):
    id: UUID
    severity: AlertSeverity
    category: str
    title: str
    message: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class CurrentConditionBrief(BaseModel):
    id: UUID
    condition: str
    severity: Optional[str] = None

    model_config = {"from_attributes": True}


class TreatmentBrief(BaseModel):
    id: UUID
    name: str
    is_active: bool

    model_config = {"from_attributes": True}


class AssignedDoctorBrief(BaseModel):
    id: str
    name: str
    role: Optional[str] = None


class PatientDenseSummary(BaseModel):
    patient: PatientHeaderOut
    active_encounter: Optional[ActiveEncounterBrief] = None
    active_medications: list[ActiveMedicationBrief]
    pending_labs: list[PendingLabBrief]
    active_alerts: list[ActiveAlertBrief]
    current_conditions: list[CurrentConditionBrief]
    active_treatments: list[TreatmentBrief]
    assigned_doctors: list[AssignedDoctorBrief]
