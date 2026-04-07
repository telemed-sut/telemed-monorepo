from datetime import datetime, timezone
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException, status

from app.models.pressure_record import PressureRecord
from app.models.patient import Patient
from app.schemas.pressure import PressureCreate

class PressureService:
    def create_pressure(self, db: Session, pressure_in: PressureCreate) -> PressureRecord:
        # Check if patient exists
        patient = db.query(Patient).filter(
            Patient.id == pressure_in.patient_id,
            Patient.deleted_at.is_(None),
            Patient.is_active == True,  # noqa: E712
        ).first()
        if not patient:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Patient with ID {pressure_in.patient_id} not found"
            )

        measured_at = pressure_in.measured_at or datetime.now(timezone.utc)
        if measured_at.tzinfo is None:
            measured_at = measured_at.replace(tzinfo=timezone.utc)

        # Create record
        db_obj = PressureRecord(
            patient_id=pressure_in.patient_id,
            device_id=pressure_in.device_id,
            heart_rate=pressure_in.heart_rate,
            sys_rate=pressure_in.sys_rate,
            dia_rate=pressure_in.dia_rate,
            wave_a=pressure_in.wave_a,
            wave_b=pressure_in.wave_b,
            measured_at=measured_at,
            # created_at is handled by DB default
        )
        
        try:
            db.add(db_obj)
            db.commit()
            db.refresh(db_obj)
        except IntegrityError:
            db.rollback()
            # If unique constraint violation (duplicate device_id + measured_at)
            # Find the existing record to be idempotent
            existing = db.query(PressureRecord).filter(
                PressureRecord.device_id == pressure_in.device_id,
                PressureRecord.measured_at == measured_at
            ).first()
            if existing:
                return existing
            
            # If other integrity error
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Database integrity error"
            )
            
        return db_obj

pressure_service = PressureService()
