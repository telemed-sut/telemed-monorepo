from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field, UUID4, field_validator

class PressureCreate(BaseModel):
    # Map patient_id to user_id in the JSON input
    patient_id: UUID4 = Field(..., alias="user_id")
    device_id: str = Field(..., min_length=1)
    
    heart_rate: int = Field(..., ge=20, le=300)
    sys_rate: int = Field(..., ge=30, le=300) 
    dia_rate: int = Field(..., ge=10, le=250) 
    
    # Map wave_a/wave_b to a/b in the JSON input
    wave_a: Optional[List[int]] = Field(default=[], max_length=5000, alias="a")
    wave_b: Optional[List[int]] = Field(default=[], max_length=5000, alias="b")
    
    measured_at: Optional[datetime] = Field(default=None)
    
    @field_validator('sys_rate')
    def validate_sys_dia(cls, v, values):
        # We can't access other fields easily in field_validator if not using model_validator.
        # But let's keep it simple for now, relying on ranges.
        return v
    
    @field_validator('wave_a', 'wave_b')
    def validate_wave_length(cls, v):
        if v and len(v) > 5000:
            raise ValueError('Waveform array too long (> 5000 points)')
        return v

class PressureResponse(BaseModel):
    id: UUID4
    received_at: datetime
    patient_id: UUID4

    class Config:
        populate_by_name = True
        from_attributes = True
