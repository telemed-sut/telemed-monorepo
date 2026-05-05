from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel

PatientTrendRiskStatus = Literal["normal", "watch", "needs_review", "no_data"]


class VitalTrendDataPoint(BaseModel):
    date: date
    recorded_at: Optional[datetime] = None
    heart_rate: Optional[int] = None
    sys_pressure: Optional[int] = None
    dia_pressure: Optional[int] = None
    weight_kg: Optional[float] = None
    height_cm: Optional[float] = None
    bmi: Optional[float] = None

class PatientVitalsTrendResponse(BaseModel):
    patient_id: str
    trends: list[VitalTrendDataPoint]
