from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.models.enums import UserRole


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class UserMeResponse(BaseModel):
    id: str
    email: str
    first_name: str | None = None
    last_name: str | None = None
    role: str
    verification_status: str | None = None


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


class InviteAcceptRequest(BaseModel):
    token: str
    first_name: str | None = None
    last_name: str | None = None
    password: str = Field(min_length=8)
    license_no: str | None = None
