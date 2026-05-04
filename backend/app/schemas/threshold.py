from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class PatientVitalThresholdBase(BaseModel):
    min_heart_rate: Optional[int] = None
    max_heart_rate: Optional[int] = None
    min_sys_pressure: Optional[int] = None
    max_sys_pressure: Optional[int] = None
    min_dia_pressure: Optional[int] = None
    max_dia_pressure: Optional[int] = None
    min_weight_kg: Optional[float] = None
    max_weight_kg: Optional[float] = None


class PatientVitalThresholdUpdate(PatientVitalThresholdBase):
    pass


class PatientVitalThresholdOut(PatientVitalThresholdBase):
    id: UUID
    patient_id: UUID
    created_at: datetime
    updated_at: datetime
    updated_by: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)
