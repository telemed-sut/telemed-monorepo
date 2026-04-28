from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class MeetingVideoTokenRequest(BaseModel):
    expires_in_seconds: int | None = Field(
        default=None,
        ge=60,
        le=7200,
        description="Optional token lifetime override in seconds.",
    )


class MeetingVideoTokenResponse(BaseModel):
    provider: Literal["mock", "zego"]
    meeting_id: str
    app_id: int | None = None
    room_id: str
    user_id: str
    token: str
    issued_at: datetime
    expires_at: datetime


class MeetingPatientInviteRequest(BaseModel):
    expires_in_seconds: int | None = Field(
        default=None,
        ge=300,
        le=604800,
        description="Optional patient invite token lifetime override in seconds.",
    )


class MeetingPatientInviteResponse(BaseModel):
    meeting_id: str
    room_id: str
    invite_token: str
    short_code: str
    invite_url: str
    issued_at: datetime
    expires_at: datetime


class MeetingPatientTokenRequest(BaseModel):
    meeting_id: str | None = Field(default=None, min_length=1, max_length=64)
    invite_token: str | None = Field(default=None, min_length=32, max_length=4096)
    short_code: str | None = Field(default=None, min_length=6, max_length=24)
    expires_in_seconds: int | None = Field(
        default=None,
        ge=60,
        le=7200,
        description="Optional ZEGO token lifetime override in seconds.",
    )

    @model_validator(mode="after")
    def validate_join_proof(self):
        if (self.invite_token or "").strip() or (self.short_code or "").strip():
            return self
        raise ValueError("Either invite_token or short_code is required.")


class MeetingPatientPresenceRequest(BaseModel):
    meeting_id: str | None = Field(default=None, min_length=1, max_length=64)
    invite_token: str | None = Field(default=None, min_length=32, max_length=4096)
    short_code: str | None = Field(default=None, min_length=6, max_length=24)

    @model_validator(mode="after")
    def validate_join_proof(self):
        if (self.invite_token or "").strip() or (self.short_code or "").strip():
            return self
        raise ValueError("Either invite_token or short_code is required.")


class MeetingRoomPresenceResponse(BaseModel):
    meeting_id: str
    state: str
    doctor_online: bool
    patient_online: bool
    refreshed_at: datetime | None = None
    patient_joined_at: datetime | None = None
    doctor_last_seen_at: datetime | None = None
    patient_last_seen_at: datetime | None = None
    doctor_left_at: datetime | None = None
    patient_left_at: datetime | None = None
    updated_at: datetime | None = None


class MeetingReliabilitySnapshotResponse(BaseModel):
    meeting_id: str
    checked_at: datetime
    heartbeat_timeout_seconds: int
    meeting_status: str
    meeting_status_before_reconcile: str
    meeting_status_reconciled: bool
    active_status_projection: str
    status_in_sync: bool | None = None
    room_presence_state: str
    doctor_online: bool
    patient_online: bool
    doctor_presence_stale: bool
    patient_presence_stale: bool
    doctor_last_seen_at: datetime | None = None
    patient_last_seen_at: datetime | None = None
    doctor_last_seen_age_seconds: int | None = None
    patient_last_seen_age_seconds: int | None = None
    doctor_left_at: datetime | None = None
    patient_left_at: datetime | None = None
    refreshed_at: datetime | None = None
    updated_at: datetime | None = None
