from datetime import datetime
from pydantic import BaseModel, Field, UUID4, field_validator


class HeartSoundCreate(BaseModel):
    patient_id: UUID4 = Field(..., alias="user_id")
    mac_address: str = Field(..., min_length=1, max_length=64)
    position: int = Field(..., ge=1, le=14)
    blob_url: str = Field(..., min_length=1, max_length=2048)
    storage_key: str | None = Field(default=None, max_length=1024)
    mime_type: str | None = Field(default=None, max_length=128)
    duration_seconds: int | None = Field(default=None, ge=0, le=60 * 60)
    recorded_at: datetime | None = Field(default=None)

    @field_validator("mac_address")
    @classmethod
    def normalize_mac_address(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("mac_address must not be empty")
        return normalized.upper()

    @field_validator("blob_url")
    @classmethod
    def validate_blob_url(cls, value: str) -> str:
        normalized = value.strip()
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


class HeartSoundIngestResponse(BaseModel):
    status: str = "ok"
    record_id: UUID4


class HeartSoundRecordOut(BaseModel):
    id: UUID4
    patient_id: UUID4
    device_id: str
    mac_address: str
    position: int
    blob_url: str
    storage_key: str | None = None
    mime_type: str | None = None
    duration_seconds: int | None = None
    recorded_at: datetime
    created_at: datetime

    model_config = {"from_attributes": True}


class HeartSoundListResponse(BaseModel):
    items: list[HeartSoundRecordOut]
