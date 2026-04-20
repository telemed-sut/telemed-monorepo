from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.heart_sound_record import HeartSoundRecord
from app.models.patient import Patient
from app.schemas.heart_sound import HeartSoundCreate, HeartSoundRecordOut
from app.services.blob_storage import azure_blob_storage_service


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

    def list_patient_heart_sounds(
        self,
        db: Session,
        patient_id: UUID,
        *,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[HeartSoundRecord], int]:
        total = db.scalar(
            select(func.count(HeartSoundRecord.id)).where(HeartSoundRecord.patient_id == patient_id)
        ) or 0

        stmt = (
            select(HeartSoundRecord)
            .where(HeartSoundRecord.patient_id == patient_id)
            .order_by(HeartSoundRecord.recorded_at.desc(), HeartSoundRecord.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        items = db.scalars(stmt).all()
        return list(items), int(total)

    def serialize_heart_sound_record(self, record: HeartSoundRecord) -> HeartSoundRecordOut:
        response = HeartSoundRecordOut.model_validate(record)
        return response.model_copy(
            update={
                "blob_url": azure_blob_storage_service.build_read_url(
                    record.storage_key,
                    record.blob_url,
                )
            }
        )


heart_sound_service = HeartSoundService()
