from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.enums import DeviceExamMeasurementType
from app.models.heart_sound_record import HeartSoundRecord
from app.models.patient import Patient
from app.schemas.heart_sound import HeartSoundCreate, HeartSoundRecordOut
from app.services.blob_storage import azure_blob_storage_service
from app.services.device_exam_session import device_exam_session_service
from app.services.device_session_events import publish_device_session_event_sync


class HeartSoundService:
    def create_heart_sound(
        self,
        db: Session,
        *,
        payload: HeartSoundCreate,
        device_id: str,
    ) -> HeartSoundRecord:
        resolved_patient_id, resolved_session_id = device_exam_session_service.resolve_ingest_context(
            db,
            device_id=device_id,
            requested_patient_id=payload.patient_id,
            requested_session_id=payload.session_id,
            measurement_type=DeviceExamMeasurementType.heart_sound,
        )
        patient = db.query(Patient).filter(
            Patient.id == resolved_patient_id,
            Patient.deleted_at.is_(None),
            Patient.is_active == True,  # noqa: E712
        ).first()
        if not patient:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Patient with ID {resolved_patient_id} not found",
            )

        existing = db.query(HeartSoundRecord).filter(HeartSoundRecord.blob_url == payload.blob_url).first()
        if existing:
            return existing

        recorded_at = payload.recorded_at or datetime.now(timezone.utc)
        if recorded_at.tzinfo is None:
            recorded_at = recorded_at.replace(tzinfo=timezone.utc)

        record = HeartSoundRecord(
            patient_id=resolved_patient_id,
            device_exam_session_id=resolved_session_id,
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
        device_exam_session_service.touch_session_last_seen(
            db,
            session_id=resolved_session_id,
            device_id=device_id,
            seen_at=recorded_at,
        )
        db.commit()
        db.refresh(record)
        if resolved_session_id is not None:
            publish_device_session_event_sync(
                event_type="device_session.measurement_received",
                session=device_exam_session_service.get_session(db, session_id=resolved_session_id),
                extra={"source": "heart_sound_ingest", "measurement_id": str(record.id)},
            )
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
