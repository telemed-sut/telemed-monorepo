from typing import List, Optional, Tuple
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.patient import Patient
from app.schemas.patient import PatientCreate, PatientUpdate

settings = get_settings()


def create_patient(db: Session, payload: PatientCreate) -> Patient:
    patient = Patient(**payload.model_dump())
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


def get_patient(db: Session, patient_id: str) -> Optional[Patient]:
    try:
        uuid_id = UUID(patient_id)
        stmt = select(Patient).where(Patient.id == uuid_id)
        return db.scalar(stmt)
    except ValueError:
        return None


def update_patient(db: Session, patient: Patient, payload: PatientUpdate) -> Patient:
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(patient, key, value)
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


def delete_patient(db: Session, patient: Patient) -> None:
    db.delete(patient)
    db.commit()


def list_patients(
    db: Session,
    page: int,
    limit: int,
    q: Optional[str],
    sort: str,
    order: str,
) -> Tuple[List[Patient], int]:
    stmt = select(Patient)

    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(
            or_(
                Patient.first_name.ilike(pattern),
                Patient.last_name.ilike(pattern),
                Patient.email.ilike(pattern),
                Patient.phone.ilike(pattern),
            )
        )

    total = db.scalar(select(func.count()).select_from(stmt.subquery()))

    sort_field = {
        "created_at": Patient.created_at,
        "updated_at": Patient.updated_at,
        "last_name": Patient.last_name,
        "first_name": Patient.first_name,
    }.get(sort, Patient.created_at)

    sort_clause = sort_field.desc() if order.lower() == "desc" else sort_field.asc()
    stmt = stmt.order_by(sort_clause)

    safe_limit = min(limit, settings.max_limit)
    offset = (page - 1) * safe_limit
    stmt = stmt.limit(safe_limit).offset(offset)

    items = db.scalars(stmt).all()
    return items, total
