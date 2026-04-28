from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException, status

from app.models.enums import DeviceExamMeasurementType
from app.models.pressure_record import PressureRecord
from app.models.patient import Patient
from app.schemas.pressure import PressureCreate, PressureRecordOut, PressureRiskAssessment, PressureRiskLevel

from app.services.device_exam_session import device_exam_session_service
from app.services.device_session_events import publish_device_session_event_sync
from app.services.pubsub import publish_realtime_event, get_patient_channel

class PressureService:
    def classify_heart_rate(self, heart_rate: int) -> tuple[PressureRiskLevel, list[str]]:
        if heart_rate < 50:
            return "danger", [f"heart_rate below 50 bpm ({heart_rate})"]
        if heart_rate > 120:
            return "danger", [f"heart_rate above 120 bpm ({heart_rate})"]
        if heart_rate < 60:
            return "moderate", [f"heart_rate below normal range 60-100 bpm ({heart_rate})"]
        if heart_rate > 100:
            return "moderate", [f"heart_rate above normal range 60-100 bpm ({heart_rate})"]
        return "normal", []

    def classify_blood_pressure(self, sys_rate: int, dia_rate: int) -> tuple[PressureRiskLevel, list[str]]:
        if sys_rate < 90:
            return "danger", [f"sys_rate below 90 mmHg ({sys_rate})"]
        if dia_rate < 60:
            return "danger", [f"dia_rate below 60 mmHg ({dia_rate})"]
        if sys_rate >= 140:
            return "danger", [f"sys_rate at least 140 mmHg ({sys_rate})"]
        if dia_rate >= 90:
            return "danger", [f"dia_rate at least 90 mmHg ({dia_rate})"]
        if sys_rate >= 120:
            return "moderate", [f"sys_rate between 120-139 mmHg ({sys_rate})"]
        if dia_rate >= 80:
            return "moderate", [f"dia_rate between 80-89 mmHg ({dia_rate})"]
        return "normal", []

    def assess_risk(self, record: PressureRecord) -> PressureRiskAssessment:
        heart_level, heart_reasons = self.classify_heart_rate(record.heart_rate)
        bp_level, bp_reasons = self.classify_blood_pressure(record.sys_rate, record.dia_rate)
        if "danger" in (heart_level, bp_level):
            level: PressureRiskLevel = "danger"
        elif "moderate" in (heart_level, bp_level):
            level = "moderate"
        else:
            level = "normal"

        return PressureRiskAssessment(
            level=level,
            heart_rate_level=heart_level,
            blood_pressure_level=bp_level,
            reasons=[*heart_reasons, *bp_reasons],
        )

    def serialize_pressure_record(self, record: PressureRecord) -> PressureRecordOut:
        return PressureRecordOut(
            id=record.id,
            patient_id=record.patient_id,
            device_exam_session_id=record.device_exam_session_id,
            device_id=record.device_id,
            heart_rate=record.heart_rate,
            sys_rate=record.sys_rate,
            dia_rate=record.dia_rate,
            measured_at=record.measured_at,
            created_at=record.created_at,
            risk=self.assess_risk(record),
        )

    def list_patient_pressure_records(
        self,
        db: Session,
        patient_id: UUID,
        *,
        limit: int,
        offset: int,
    ) -> tuple[list[PressureRecord], int]:
        total = db.scalar(
            select(func.count(PressureRecord.id)).where(PressureRecord.patient_id == patient_id)
        ) or 0
        items = db.scalars(
            select(PressureRecord)
            .where(PressureRecord.patient_id == patient_id)
            .order_by(PressureRecord.measured_at.desc(), PressureRecord.created_at.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        return list(items), total

    def create_pressure(self, db: Session, pressure_in: PressureCreate) -> PressureRecord:
        resolved_patient_id, resolved_session_id = device_exam_session_service.resolve_ingest_context(
            db,
            device_id=pressure_in.device_id,
            requested_patient_id=pressure_in.patient_id,
            requested_session_id=pressure_in.session_id,
            measurement_type=DeviceExamMeasurementType.blood_pressure,
        )
        # Check if patient exists
        patient = db.query(Patient).filter(
            Patient.id == resolved_patient_id,
            Patient.deleted_at.is_(None),
            Patient.is_active == True,  # noqa: E712
        ).first()
        if not patient:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Patient with ID {resolved_patient_id} not found"
            )

        measured_at = pressure_in.measured_at or datetime.now(timezone.utc)
        if measured_at.tzinfo is None:
            measured_at = measured_at.replace(tzinfo=timezone.utc)

        # Create record
        db_obj = PressureRecord(
            patient_id=resolved_patient_id,
            device_exam_session_id=resolved_session_id,
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
            device_exam_session_service.touch_session_last_seen(
                db,
                session_id=resolved_session_id,
                device_id=pressure_in.device_id,
                seen_at=measured_at,
            )
            db.commit()
            db.refresh(db_obj)
            
            # Publish real-time event
            event_data = {
                "id": str(db_obj.id),
                "patient_id": str(db_obj.patient_id),
                "device_exam_session_id": str(db_obj.device_exam_session_id) if db_obj.device_exam_session_id else None,
                "sys_rate": db_obj.sys_rate,
                "dia_rate": db_obj.dia_rate,
                "heart_rate": db_obj.heart_rate,
                "measured_at": db_obj.measured_at.isoformat(),
            }
            publish_realtime_event(
                get_patient_channel(str(db_obj.patient_id)),
                "new_pressure_reading",
                event_data
            )
            if resolved_session_id is not None:
                publish_device_session_event_sync(
                    event_type="device_session.measurement_received",
                    session=device_exam_session_service.get_session(db, session_id=resolved_session_id),
                    extra={"source": "pressure_ingest", "measurement_id": str(db_obj.id)},
                )
            
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
