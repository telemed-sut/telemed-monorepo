from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


AssignmentRole = Literal["primary", "consulting"]


class AssignmentDoctorBrief(BaseModel):
    id: UUID
    email: str
    first_name: str | None = None
    last_name: str | None = None

    model_config = {"from_attributes": True}


class PatientAssignmentCreate(BaseModel):
    doctor_id: UUID
    role: AssignmentRole | None = None


class PatientAssignmentUpdate(BaseModel):
    role: AssignmentRole


class PatientAssignmentOut(BaseModel):
    id: UUID
    doctor_id: UUID
    patient_id: UUID
    role: AssignmentRole
    assigned_at: datetime
    doctor: AssignmentDoctorBrief | None = None

    model_config = {"from_attributes": True}


class PatientAssignmentListResponse(BaseModel):
    items: list[PatientAssignmentOut]
    total: int
