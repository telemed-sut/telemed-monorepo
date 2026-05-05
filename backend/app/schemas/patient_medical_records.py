"""Pydantic schemas for the patient mobile-app medical-records screens.

Aggregates vitals, weight history, conditions, medications, and allergies into
one bundle (`/patient-app/me/medical-records`), plus separate sub-endpoints
for visits (encounters) and labs.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class PatientVitalsOut(BaseModel):
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    blood_type: Optional[str] = None
    bmi: Optional[float] = None
    latest_blood_pressure: Optional[str] = None
    latest_heart_rate: Optional[int] = None
    last_measured_at: Optional[datetime] = None


class WeightRecordOut(BaseModel):
    id: UUID
    weight_kg: float
    height_cm: Optional[float] = None
    measured_at: datetime


class ConditionOut(BaseModel):
    id: UUID
    name: str
    status: str
    severity: Optional[str] = None
    diagnosed_at: Optional[datetime] = None
    notes: Optional[str] = None


class MedicationOut(BaseModel):
    id: UUID
    name: str
    dosage: Optional[str] = None
    frequency: Optional[str] = None
    route: Optional[str] = None
    status: str
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    notes: Optional[str] = None


class AllergyOut(BaseModel):
    name: str
    severity: Optional[str] = None
    reaction: Optional[str] = None


class MedicalRecordsBundleOut(BaseModel):
    vitals: PatientVitalsOut
    weight_history: list[WeightRecordOut]
    conditions: list[ConditionOut]
    medications: list[MedicationOut]
    allergies: list[AllergyOut]


class DoctorBriefOut(BaseModel):
    id: UUID
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None


class VisitOut(BaseModel):
    id: UUID
    encounter_type: str
    status: str
    admitted_at: datetime
    discharged_at: Optional[datetime] = None
    ward: Optional[str] = None
    bed_number: Optional[str] = None
    chief_complaint: Optional[str] = None
    discharge_summary: Optional[str] = None
    doctor: Optional[DoctorBriefOut] = None


class VisitListResponse(BaseModel):
    items: list[VisitOut]
    total: int


class LabOut(BaseModel):
    id: UUID
    test_name: str
    category: Optional[str] = None
    status: str
    ordered_at: datetime
    resulted_at: Optional[datetime] = None
    result_value: Optional[str] = None
    result_unit: Optional[str] = None
    reference_range: Optional[str] = None
    is_abnormal: bool
    notes: Optional[str] = None
    doctor: Optional[DoctorBriefOut] = None


class LabListResponse(BaseModel):
    items: list[LabOut]
    total: int


class HeartSoundOut(BaseModel):
    id: UUID
    device_id: str
    position: int
    blob_url: str
    duration_seconds: Optional[int] = None
    recorded_at: datetime
    created_at: datetime


class HeartSoundListResponse(BaseModel):
    items: list[HeartSoundOut]
    total: int


class PatientProfileUpdateRequest(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None


class PatientProfileOut(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    blood_group: Optional[str] = None
    date_of_birth: Optional[datetime] = None
    gender: Optional[str] = None
