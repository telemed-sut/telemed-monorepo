import re
from datetime import datetime
from typing import List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.models.enums import UserRole, VerificationStatus

# Roles considered clinical (require license info)
CLINICAL_ROLES = {
    UserRole.doctor,
}

ACTIVE_USER_ROLES = {
    UserRole.admin,
    UserRole.doctor,
    UserRole.medical_student,
}

# Thai medical license pattern: ว.NNNNN, พ.NNNNN, MD12345, MD-TEST, or plain digits
LICENSE_NO_PATTERN = re.compile(r"^([A-Za-z\u0E00-\u0E7F]{1,10}[.-]?[A-Za-z0-9]{0,10}|\d{4,10})$")


def _validate_active_user_role(value: UserRole) -> UserRole:
    if value not in ACTIVE_USER_ROLES:
        raise ValueError("Role must be one of: admin, doctor, medical_student.")
    return value


class UserBase(BaseModel):
    email: EmailStr
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: UserRole = UserRole.medical_student
    is_active: bool = True
    specialty: Optional[str] = None
    department: Optional[str] = None
    license_no: Optional[str] = None
    license_expiry: Optional[datetime] = None
    verification_status: VerificationStatus = VerificationStatus.unverified

    @field_validator("license_no")
    @classmethod
    def validate_license_no(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v.strip() != "" and not LICENSE_NO_PATTERN.match(v):
            raise ValueError(
                "Invalid license number format. Expected pattern like ว.12345 or MD12345."
            )
        return v

    @field_validator("role")
    @classmethod
    def validate_role(cls, value: UserRole) -> UserRole:
        return _validate_active_user_role(value)

    @field_validator("license_expiry")
    @classmethod
    def validate_license_expiry(cls, v: Optional[datetime]) -> Optional[datetime]:
        if v is not None:
            from datetime import timezone
            # Treat naive datetimes as UTC
            aware_v = v if v.tzinfo is not None else v.replace(tzinfo=timezone.utc)
            if aware_v < datetime.now(timezone.utc):
                raise ValueError("License expiry date must be in the future.")
        return v


class UserCreate(UserBase):
    password: str | None = Field(default=None, min_length=8)
    patient_assignment_scope: Literal["all", "ward", "none"] = "none"
    target_ward: Optional[str] = None

    @model_validator(mode="after")
    def validate_patient_assignment(self) -> "UserCreate":
        normalized_target_ward = self.target_ward.strip() if isinstance(self.target_ward, str) else None
        self.target_ward = normalized_target_ward or None

        if self.patient_assignment_scope == "ward" and not self.target_ward:
            raise ValueError("target_ward is required when patient_assignment_scope is 'ward'.")

        if self.patient_assignment_scope != "ward":
            self.target_ward = None

        return self


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    password: Optional[str] = Field(None, min_length=8)
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None
    specialty: Optional[str] = None
    department: Optional[str] = None
    license_no: Optional[str] = None
    license_expiry: Optional[datetime] = None
    verification_status: Optional[VerificationStatus] = None

    @field_validator("license_no")
    @classmethod
    def validate_license_no(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v.strip() != "" and not LICENSE_NO_PATTERN.match(v):
            raise ValueError(
                "Invalid license number format. Expected pattern like ว.12345 or MD12345."
            )
        return v

    @field_validator("role")
    @classmethod
    def validate_role(cls, value: Optional[UserRole]) -> Optional[UserRole]:
        if value is None:
            return value
        return _validate_active_user_role(value)


class UserOut(BaseModel):
    id: UUID
    email: EmailStr
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: UserRole
    is_active: bool = True
    specialty: Optional[str] = None
    department: Optional[str] = None
    license_no: Optional[str] = None
    license_expiry: Optional[datetime] = None
    verification_status: VerificationStatus = VerificationStatus.unverified
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None
    deleted_by: Optional[UUID] = None
    restored_at: Optional[datetime] = None
    restored_by: Optional[UUID] = None
    privileged_roles: List[str] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class UserCreateResponse(UserOut):
    assigned_patient_count: int = 0


class UserListResponse(BaseModel):
    items: List[UserOut]
    page: int
    limit: int
    total: int


class UserInviteCreateRequest(BaseModel):
    email: EmailStr
    role: UserRole = UserRole.medical_student
    reason: str | None = Field(default=None, min_length=8, max_length=300)

    @field_validator("role")
    @classmethod
    def validate_role(cls, value: UserRole) -> UserRole:
        return _validate_active_user_role(value)


class UserInviteCreateResponse(BaseModel):
    invite_url: str
    expires_at: datetime
