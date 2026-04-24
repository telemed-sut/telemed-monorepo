from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, UUID4, field_validator, model_validator

from app.models.enums import DeviceExamSessionStatus, DeviceMeasurementRoutingStatus


class LungSoundCreate(BaseModel):
    patient_id: UUID4 | None = Field(default=None, alias="user_id")
    session_id: UUID4 | None = None
    device_id: str = Field(..., min_length=1, max_length=128)
    position: int = Field(..., ge=1, le=14)
    blob_url: str | None = Field(default=None, max_length=2048)
    storage_key: str | None = Field(default=None, max_length=1024)
    mime_type: str | None = Field(default=None, max_length=128)
    duration_seconds: int | None = Field(default=None, ge=0, le=60 * 60)
    sample_rate_hz: int | None = Field(default=None, ge=100, le=384_000)
    channel_count: int | None = Field(default=None, ge=1, le=16)
    wheeze_score: int | None = Field(default=None, ge=0, le=100)
    crackle_score: int | None = Field(default=None, ge=0, le=100)
    analysis: dict[str, Any] | None = None
    recorded_at: datetime | None = None

    @field_validator("device_id")
    @classmethod
    def normalize_device_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("device_id must not be empty")
        return normalized

    @field_validator("blob_url")
    @classmethod
    def validate_blob_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            return None
        if not normalized.startswith(("http://", "https://")):
            raise ValueError("blob_url must be an absolute http(s) URL")
        return normalized

    @field_validator("storage_key", "mime_type")
    @classmethod
    def normalize_optional_strings(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class LungSoundIngestResponse(BaseModel):
    status: str = "ok"
    record_id: UUID4 | None = None


class LungSoundRecordOut(BaseModel):
    id: UUID4
    patient_id: UUID4 | None = None
    device_exam_session_id: UUID4 | None = None
    device_id: str
    routing_status: DeviceMeasurementRoutingStatus
    position: int
    blob_url: str | None = None
    storage_key: str | None = None
    mime_type: str | None = None
    duration_seconds: int | None = None
    sample_rate_hz: int | None = None
    channel_count: int | None = None
    wheeze_score: int | None = None
    crackle_score: int | None = None
    analysis: dict[str, Any] | None = None
    conflict_metadata: dict[str, Any] | None = None
    recorded_at: datetime
    server_received_at: datetime
    created_at: datetime

    model_config = {"from_attributes": True}


class LungSoundReviewQueueItem(BaseModel):
    record_id: UUID4
    device_id: str
    routing_status: DeviceMeasurementRoutingStatus
    position: int
    recorded_at: datetime
    server_received_at: datetime
    patient_id: UUID4 | None = None
    patient_name: str | None = None
    device_exam_session_id: UUID4 | None = None
    session_status: DeviceExamSessionStatus | None = None
    conflict_metadata: dict[str, Any] | None = None


class LungSoundReviewQueueResponse(BaseModel):
    items: list[LungSoundReviewQueueItem]
    total: int
    needs_review_count: int
    unmatched_count: int
    generated_at: datetime


class LungSoundReviewResolveRequest(BaseModel):
    resolution: Literal["verified", "quarantined"] = "verified"
    target_session_id: UUID4 | None = None
    note: str | None = Field(default=None, max_length=500)

    @field_validator("note")
    @classmethod
    def normalize_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @model_validator(mode="after")
    def validate_resolution_fields(self) -> "LungSoundReviewResolveRequest":
        if self.resolution == "verified" and self.target_session_id is None:
            raise ValueError("target_session_id is required when resolution is verified")
        if self.resolution == "quarantined" and self.target_session_id is not None:
            raise ValueError("target_session_id must be omitted when resolution is quarantined")
        return self
