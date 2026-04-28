from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

from app.models.enums import UserRole


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)


class StepUpAuthRequest(BaseModel):
    password: str = Field(min_length=8)


class UserMeResponse(BaseModel):
    id: str
    email: str
    first_name: str | None = None
    last_name: str | None = None
    role: str
    verification_status: str | None = None
    mfa_verified: bool = False
    mfa_authenticated_at: datetime | None = None
    mfa_recent_for_privileged_actions: bool = False
    auth_source: str = "local"
    sso_provider: str | None = None
    passkey_onboarding_dismissed: bool = False
    passkey_count: int = 0


class AccessProfileResponse(BaseModel):
    has_privileged_access: bool = False
    access_class: str | None = None
    access_class_revealed: bool = False
    can_manage_privileged_admins: bool = False
    can_manage_security_recovery: bool = False
    can_bootstrap_privileged_roles: bool = False


class AdminSSOStatusResponse(BaseModel):
    enabled: bool
    provider: str | None = None
    enforced_for_admin: bool = False
    login_path: str | None = None
    logout_path: str | None = None


class AdminSSOHealthResponse(BaseModel):
    status: Literal["disabled", "healthy", "misconfigured", "unreachable"]
    provider: str | None = None
    issuer: str | None = None
    details: str | None = None
    metadata_endpoint: str | None = None


class AdminSSOLogoutResponse(BaseModel):
    redirect_url: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserMeResponse | None = None


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ForgotPasswordResponse(BaseModel):
    message: str
    reset_token: str | None = None


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8)


class MessageResponse(BaseModel):
    message: str


class InviteInfoResponse(BaseModel):
    email: EmailStr
    role: UserRole
    expires_at: datetime


class InviteTokenRequest(BaseModel):
    token: str = Field(min_length=16, max_length=4096)


class InviteAcceptRequest(BaseModel):
    token: str
    first_name: str | None = None
    last_name: str | None = None
    password: str = Field(min_length=8)
    license_no: str | None = None
