from datetime import datetime
from typing import List, Literal, Optional
from pydantic import BaseModel, Field, UUID4, field_validator, model_validator

PressureRiskLevel = Literal["normal", "moderate", "danger"]

class PressureCreate(BaseModel):
    device_id: str = Field(..., min_length=1, max_length=128)
    
    heart_rate: int = Field(..., ge=0, le=300)
    sys_rate: int = Field(..., ge=0, le=300) 
    dia_rate: int = Field(..., ge=0, le=250) 
    
    # Map wave_a/wave_b to a/b in the JSON input
    wave_a: Optional[List[int]] = Field(default=None, max_length=5000, alias="a")
    wave_b: Optional[List[int]] = Field(default=None, max_length=5000, alias="b")

    @field_validator("device_id")
    @classmethod
    def normalize_device_id(cls, v: str) -> str:
        value = v.strip()
        if not value:
            raise ValueError("device_id must not be empty")
        return value
    
    @field_validator('wave_a', 'wave_b')
    @classmethod
    def validate_wave_length(cls, v):
        if v and len(v) > 5000:
            raise ValueError('Waveform array too long (> 5000 points)')
        return v

    @model_validator(mode="after")
    def validate_pressure_and_waveform(self):
        if self.sys_rate > 0 and self.dia_rate > 0 and self.sys_rate <= self.dia_rate:
            raise ValueError("sys_rate must be greater than dia_rate")

        if self.wave_a is not None and self.wave_b is not None and len(self.wave_a) != len(self.wave_b):
            raise ValueError("a and b must have the same length")

        return self

class PressureIngestResponse(BaseModel):
    status: str = "ok"


class PressureRiskAssessment(BaseModel):
    level: PressureRiskLevel
    heart_rate_level: PressureRiskLevel
    blood_pressure_level: PressureRiskLevel
    reasons: list[str] = Field(default_factory=list)


class PressureRecordOut(BaseModel):
    id: UUID4
    patient_id: UUID4
    device_exam_session_id: UUID4 | None = None
    device_id: str
    heart_rate: int
    sys_rate: int
    dia_rate: int
    measured_at: datetime
    created_at: datetime
    risk: PressureRiskAssessment

    model_config = {"from_attributes": True}


class PressureListResponse(BaseModel):
    items: list[PressureRecordOut]
    total: int
    limit: int
    offset: int
    latest: PressureRecordOut | None = None
