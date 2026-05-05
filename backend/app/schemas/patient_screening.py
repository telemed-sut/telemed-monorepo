"""Pydantic schemas for the daily heart-failure screening submitted from
the patient mobile app.

`recorded_at` and `created_at` are server-generated and only appear in
response shapes. The submission schema (`PatientScreeningCreate`) does not
accept them.
"""

from datetime import date, datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PatientScreeningCreate(BaseModel):
    # Symptoms — defaults are False, which matches "ไม่ตอบ ถือว่าปกติ".
    symptom_more_tired: bool = Field(default=False)
    symptom_cannot_lie_flat: bool = Field(default=False)
    symptom_paroxysmal_nocturnal_dyspnea: bool = Field(default=False)
    symptom_more_than_one_pillow: bool = Field(default=False)

    # Vitals — all optional. Range guards are loose because at-home cuffs vary.
    systolic_bp: Optional[int] = Field(default=None, ge=40, le=300)
    diastolic_bp: Optional[int] = Field(default=None, ge=20, le=200)
    heart_rate: Optional[int] = Field(default=None, ge=20, le=300)
    oxygen_saturation: Optional[int] = Field(default=None, ge=50, le=100)
    weight_kg: Optional[float] = Field(default=None, gt=0, le=500)

    # Warning signs the patient self-flags.
    warning_dyspnea_orthopnea: bool = Field(default=False)
    warning_abnormal_vitals: bool = Field(default=False)

    notes: Optional[str] = Field(default=None, max_length=2000)

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "symptom_more_tired": True,
                "symptom_cannot_lie_flat": False,
                "symptom_paroxysmal_nocturnal_dyspnea": False,
                "symptom_more_than_one_pillow": False,
                "systolic_bp": 128,
                "diastolic_bp": 82,
                "heart_rate": 78,
                "oxygen_saturation": 97,
                "weight_kg": 70.5,
                "warning_dyspnea_orthopnea": False,
                "warning_abnormal_vitals": False,
                "notes": "เหนื่อยกว่าปกติเล็กน้อย",
            },
        }
    )


class PatientScreeningOut(BaseModel):
    id: UUID
    patient_id: UUID

    symptom_more_tired: bool
    symptom_cannot_lie_flat: bool
    symptom_paroxysmal_nocturnal_dyspnea: bool
    symptom_more_than_one_pillow: bool

    systolic_bp: Optional[int] = None
    diastolic_bp: Optional[int] = None
    heart_rate: Optional[int] = None
    oxygen_saturation: Optional[int] = None
    weight_kg: Optional[float] = None

    warning_dyspnea_orthopnea: bool
    warning_abnormal_vitals: bool

    notes: Optional[str] = None

    recorded_at: datetime
    created_at: datetime

    has_any_symptom: bool
    has_any_warning_sign: bool

    model_config = ConfigDict(from_attributes=True)


class PatientScreeningListResponse(BaseModel):
    items: list[PatientScreeningOut]
    total: int


class ScreeningTrendPoint(BaseModel):
    date: date
    systolic_bp: Optional[int] = None
    diastolic_bp: Optional[int] = None
    heart_rate: Optional[int] = None
    oxygen_saturation: Optional[int] = None
    weight_kg: Optional[float] = None
    has_any_symptom: bool = False
    has_any_warning_sign: bool = False


class ScreeningTrendsResponse(BaseModel):
    days: int
    points: list[ScreeningTrendPoint]
