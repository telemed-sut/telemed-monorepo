from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.heart_sound_record import HeartSoundRecord
from app.models.patient import Patient
from app.schemas.heart_sound import HeartSoundCreate


class HeartSoundService:
    def create_heart_sound(
        self,
        db: Session,
        *,
        payload: HeartSoundCreate,
        device_id: str,
    ) -> HeartSoundRecord:
        patient = db.query(Patient).filter(
            Patient.id == payload.patient_id,
            Patient.deleted_at.is_(None),
            Patient.is_active == True,  # noqa: E712
        ).first()
        if not patient:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Patient with ID {payload.patient_id} not found",
            )

        existing = db.query(HeartSoundRecord).filter(HeartSoundRecord.blob_url == payload.blob_url).first()
        if existing:
            return existing

        recorded_at = payload.recorded_at or datetime.now(timezone.utc)
        if recorded_at.tzinfo is None:
            recorded_at = recorded_at.replace(tzinfo=timezone.utc)

        record = HeartSoundRecord(
            patient_id=payload.patient_id,
            device_id=device_id,
            mac_address=payload.mac_address,
            position=payload.position,
            blob_url=payload.blob_url,
            storage_key=payload.storage_key,
            mime_type=payload.mime_type,
            duration_seconds=payload.duration_seconds,
            recorded_at=recorded_at,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return record

    def list_patient_heart_sounds(self, db: Session, patient_id: UUID) -> list[HeartSoundRecord]:
        return (
            db.query(HeartSoundRecord)
            .filter(HeartSoundRecord.patient_id == patient_id)
            .order_by(HeartSoundRecord.recorded_at.desc(), HeartSoundRecord.created_at.desc())
            .all()
        )


heart_sound_service = HeartSoundService()
