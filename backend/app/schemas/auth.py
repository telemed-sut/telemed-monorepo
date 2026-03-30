from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.models.enums import UserRole


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    otp_code: str | None = Field(default=None, min_length=6, max_length=10)
    remember_device: bool = False


class UserMeResponse(BaseModel):
    id: str
    email: str
    first_name: str | None = None
    last_name: str | None = None
    role: str
    verification_status: str | None = None
    two_factor_enabled: bool = False
    mfa_verified: bool = False
    mfa_authenticated_at: datetime | None = None
    mfa_recent_for_privileged_actions: bool = False
    auth_source: str = "local"
    sso_provider: str | None = None
    is_super_admin: bool = False
    privileged_roles: list[str] = Field(default_factory=list)
    can_manage_privileged_admins: bool = False
    can_manage_security_recovery: bool = False
    can_bootstrap_privileged_roles: bool = False


class AdminSSOStatusResponse(BaseModel):
    enabled: bool
    provider: str | None = None
    enforced_for_admin: bool = False
    login_path: str | None = None
    logout_path: str | None = None


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


class Admin2FAStatusResponse(BaseModel):
    required: bool
    enabled: bool
    setup_required: bool
    issuer: str | None = None
    account_email: EmailStr | None = None
    provisioning_uri: str | None = None
    trusted_device_days: int | None = None


class Admin2FAVerifyRequest(BaseModel):
    otp_code: str = Field(min_length=6, max_length=10)


class Admin2FAResetRequest(BaseModel):
    current_otp_code: str | None = Field(default=None, min_length=6, max_length=10)
    reason: str | None = None


class TwoFactorStatusResponse(Admin2FAStatusResponse):
    role: str


class TwoFactorVerifyRequest(BaseModel):
    otp_code: str = Field(min_length=6, max_length=32)


class TwoFactorDisableRequest(BaseModel):
    current_otp_code: str = Field(min_length=6, max_length=32)


class TwoFactorBackupCodeUseRequest(BaseModel):
    code: str = Field(min_length=6, max_length=32)


class TrustedDeviceOut(BaseModel):
    id: str
    ip_address: str | None = None
    created_at: datetime
    last_used_at: datetime | None = None
    expires_at: datetime
    current_device: bool = False


class TrustedDeviceListResponse(BaseModel):
    items: list[TrustedDeviceOut]
    total: int


class TrustedDevicesRevokeAllResponse(BaseModel):
    revoked: int


class BackupCodesResponse(BaseModel):
    codes: list[str]
    generated_at: datetime
    expires_at: datetime | None = None


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
