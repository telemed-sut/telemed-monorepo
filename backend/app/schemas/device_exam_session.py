from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.models.enums import (
    DeviceExamMeasurementType,
    DeviceExamSessionResolutionReason,
    DeviceExamSessionStatus,
)


class DeviceExamSessionCreate(BaseModel):
    patient_id: UUID
    device_id: str = Field(..., min_length=1, max_length=128)
    measurement_type: DeviceExamMeasurementType
    encounter_id: UUID | None = None
    notes: str | None = Field(default=None, max_length=1000)
    activate_now: bool = True

    @field_validator("device_id")
    @classmethod
    def normalize_device_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("device_id must not be empty")
        return normalized

    @field_validator("notes")
    @classmethod
    def normalize_notes(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class DeviceExamSessionStatusUpdate(BaseModel):
    notes: str | None = Field(default=None, max_length=1000)

    @field_validator("notes")
    @classmethod
    def normalize_notes(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class DeviceExamSessionOut(BaseModel):
    id: UUID
    patient_id: UUID
    encounter_id: UUID | None = None
    device_id: str
    measurement_type: DeviceExamMeasurementType
    status: DeviceExamSessionStatus
    resolution_reason: DeviceExamSessionResolutionReason | None = None
    pairing_code: str | None = None
    notes: str | None = None
    started_by: UUID | None = None
    ended_by: UUID | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    last_seen_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DeviceExamSessionListResponse(BaseModel):
    items: list[DeviceExamSessionOut]
    total: int


class DeviceExamSessionHeartbeatResponse(BaseModel):
    status: str = "ok"
    session_id: UUID
    last_seen_at: datetime


class DeviceExamSessionLiveBoardItem(BaseModel):
    session_id: UUID
    patient_id: UUID
    patient_name: str
    encounter_id: UUID | None = None
    device_id: str
    device_display_name: str | None = None
    measurement_type: DeviceExamMeasurementType
    status: DeviceExamSessionStatus
    started_at: datetime | None = None
    last_seen_at: datetime | None = None
    freshness_status: str
    seconds_since_last_seen: int | None = None
    pairing_code: str | None = None


class DeviceExamSessionLiveBoardResponse(BaseModel):
    items: list[DeviceExamSessionLiveBoardItem]
    total: int
    active_count: int
    pending_pair_count: int
    stale_count: int
    generated_at: datetime


class DeviceInventoryItem(BaseModel):
    device_id: str
    device_display_name: str
    default_measurement_type: DeviceExamMeasurementType
    is_active: bool
    device_last_seen_at: datetime | None = None
    availability_status: str
    session_id: UUID | None = None
    patient_id: UUID | None = None
    patient_name: str | None = None
    measurement_type: DeviceExamMeasurementType | None = None
    session_started_at: datetime | None = None
    session_last_seen_at: datetime | None = None
    freshness_status: str | None = None


class DeviceInventoryResponse(BaseModel):
    items: list[DeviceInventoryItem]
    total: int
    idle_count: int
    in_use_count: int
    busy_count: int
    inactive_count: int
    generated_at: datetime
