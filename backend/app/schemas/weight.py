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


class WeightRecordCreate(WeightRecordBase):
    """Inbound payload. `measured_at` is intentionally omitted — the server
    timestamps every weight record with the current UTC time."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "weight_kg": 72.5,
                "height_cm": 170.0,
            },
        },
    )


class WeightRecordUpdate(BaseModel):
    """Update payload. `measured_at` is server-controlled and cannot be edited."""

    weight_kg: Optional[float] = Field(None, description="Patient weight in kilograms.")
    height_cm: Optional[float] = Field(None, description="Patient height in centimeters.")


class WeightRecordOut(WeightRecordBase):
    id: UUID
    patient_id: UUID
    measured_at: datetime
    created_at: datetime
    recorded_by: Optional[UUID] = None
    bmi: Optional[float] = None

    model_config = ConfigDict(from_attributes=True)


class WeightRecordListResponse(BaseModel):
    items: list[WeightRecordOut]
    total: int
