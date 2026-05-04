from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class WeightRecordBase(BaseModel):
    weight_kg: float = Field(
        description="Patient weight in kilograms recorded by the patient mobile app or care team.",
        examples=[72.5],
    )
    height_cm: Optional[float] = Field(
        default=None,
        description="Optional patient height in centimeters recorded with the weight reading.",
        examples=[170.0],
    )
    measured_at: Optional[datetime] = Field(
        default=None,
        description="When the patient measured the weight. If omitted, the server records the current time.",
        examples=["2026-05-01T08:30:00+07:00"],
    )


class WeightRecordCreate(WeightRecordBase):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "weight_kg": 72.5,
                "height_cm": 170.0,
                "measured_at": "2026-05-01T08:30:00+07:00",
            },
        },
    )


class WeightRecordUpdate(BaseModel):
    weight_kg: Optional[float] = Field(None, description="Patient weight in kilograms.")
    height_cm: Optional[float] = Field(None, description="Patient height in centimeters.")
    measured_at: Optional[datetime] = Field(None, description="When the patient measured the weight.")


class WeightRecordOut(WeightRecordBase):
    id: UUID
    patient_id: UUID
    created_at: datetime
    recorded_by: Optional[UUID] = None
    bmi: Optional[float] = None

    model_config = ConfigDict(from_attributes=True)


class WeightRecordListResponse(BaseModel):
    items: list[WeightRecordOut]
    total: int
