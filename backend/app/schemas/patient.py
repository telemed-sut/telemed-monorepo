from datetime import date, datetime
from typing import List, Optional
from uuid import UUID
import re

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


class PatientBase(BaseModel):
    first_name: str = Field(min_length=2, max_length=100)
    last_name: str = Field(min_length=2, max_length=100)
    name: Optional[str] = Field(default=None, max_length=200)
    people_id: Optional[str] = Field(default=None, max_length=20)
    age: Optional[int] = Field(default=None, ge=0, le=200)
    status: Optional[str] = Field(default="active", max_length=50)
    doctor: Optional[str] = Field(default=None, max_length=200)
    date_of_birth: date
    gender: Optional[str] = Field(default=None, max_length=20)
    phone: Optional[str] = Field(default=None, min_length=8, max_length=50)
    email: Optional[EmailStr] = None
    address: Optional[str] = Field(default=None, min_length=5, max_length=255)

    # Dense mode clinical fields
    allergies: Optional[str] = None
    blood_group: Optional[str] = Field(default=None, max_length=10)
    risk_score: Optional[int] = Field(default=None, ge=0, le=10)
    primary_diagnosis: Optional[str] = Field(default=None, max_length=500)
    ward: Optional[str] = Field(default=None, max_length=100)
    bed_number: Optional[str] = Field(default=None, max_length=20)

    @model_validator(mode="before")
    @classmethod
    def auto_fill_name(cls, data):
        """Auto-generate name from first_name + last_name if not provided"""
        if isinstance(data, dict):
            if not data.get("name") and data.get("first_name") and data.get("last_name"):
                data["name"] = f"{data['first_name']} {data['last_name']}"
        return data

    @field_validator('first_name', 'last_name')
    @classmethod
    def validate_name(cls, v: str) -> str:
        # Remove leading/trailing whitespace
        v = v.strip()
        
        # Check if name is too short after stripping
        if len(v) < 2:
            raise ValueError('Name must be at least 2 characters long')
        
        # Just ensure it's not empty and contains some valid characters
        # Allow any letters, numbers, spaces, hyphens, and apostrophes
        if not re.match(r"^[a-zA-Z0-9\u0E00-\u0E7F\s'-]+$", v):
            raise ValueError('Name contains invalid characters')
        
        return v

    @field_validator('phone')
    @classmethod
    def validate_phone(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        
        # Remove only spaces and dashes (keep dots and x for extensions)
        cleaned = re.sub(r'[\s-]', '', v)
        
        # Check if it's too long (max 50 chars)
        if len(cleaned) > 50:
            raise ValueError('Phone number is too long (max 50 characters)')
        
        # Check if it contains only valid phone characters (digits, +, (), x, and .)
        if not re.match(r'^[\d+().x]+$', cleaned, re.IGNORECASE):
            raise ValueError('Phone number contains invalid characters')
        
        return cleaned

    @field_validator('address')
    @classmethod
    def validate_address(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        
        v = v.strip()
        
        # Check minimum length
        if len(v) < 5:
            raise ValueError('Address must be at least 5 characters long')
        
        return v

    @field_validator('date_of_birth')
    @classmethod
    def validate_date_of_birth(cls, v: date) -> date:
        today = date.today()
        
        # Check if date is in the future
        if v > today:
            raise ValueError('Date of birth cannot be in the future')
        
        # Check if age is reasonable (0-150 years old)
        age = (today - v).days // 365
        if age > 150:
            raise ValueError('Date of birth is too far in the past')
        
        return v


class PatientCreate(PatientBase):
    pass


class PatientUpdate(BaseModel):
    first_name: Optional[str] = Field(default=None, max_length=100)
    last_name: Optional[str] = Field(default=None, max_length=100)
    name: Optional[str] = Field(default=None, max_length=200)
    people_id: Optional[str] = Field(default=None, max_length=20)
    age: Optional[int] = Field(default=None, ge=0, le=200)
    status: Optional[str] = Field(default=None, max_length=50)
    doctor: Optional[str] = Field(default=None, max_length=200)
    date_of_birth: Optional[date] = None
    gender: Optional[str] = Field(default=None, max_length=20)
    phone: Optional[str] = Field(default=None, max_length=50)
    email: Optional[EmailStr] = None
    address: Optional[str] = Field(default=None, max_length=255)
    allergies: Optional[str] = None
    blood_group: Optional[str] = Field(default=None, max_length=10)
    risk_score: Optional[int] = Field(default=None, ge=0, le=10)
    primary_diagnosis: Optional[str] = Field(default=None, max_length=500)
    ward: Optional[str] = Field(default=None, max_length=100)
    bed_number: Optional[str] = Field(default=None, max_length=20)


class PatientOut(PatientBase):
    id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PatientProfileOut(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    name: Optional[str] = None
    people_id: Optional[str] = None
    age: Optional[int] = None
    status: Optional[str] = None
    doctor: Optional[str] = None
    date_of_birth: date
    gender: Optional[str] = None
    allergies: Optional[str] = None
    blood_group: Optional[str] = None
    risk_score: Optional[int] = None
    primary_diagnosis: Optional[str] = None
    ward: Optional[str] = None
    bed_number: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PatientListItemOut(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    name: Optional[str] = None
    status: Optional[str] = None
    ward: Optional[str] = None
    date_of_birth: date
    gender: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PatientListResponse(BaseModel):
    items: List[PatientListItemOut]
    page: int
    limit: int
    total: int


class PatientWardListResponse(BaseModel):
    wards: List[str]


class PatientContactDetailsResponse(BaseModel):
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    address: Optional[str] = None
