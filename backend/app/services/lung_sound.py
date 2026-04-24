from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.enums import DeviceExamMeasurementType, DeviceMeasurementRoutingStatus
from app.models.lung_sound_record import LungSoundRecord
from app.models.patient import Patient
from app.schemas.lung_sound import LungSoundCreate, LungSoundRecordOut
from app.services.device_exam_session import device_exam_session_service
from app.services.device_session_events import publish_device_session_event_sync


class LungSoundService:
    def create_lung_sound(self, db: Session, payload: LungSoundCreate) -> LungSoundRecord:
        recorded_at = payload.recorded_at or datetime.now(timezone.utc)
        if recorded_at.tzinfo is None:
            recorded_at = recorded_at.replace(tzinfo=timezone.utc)
        server_received_at = datetime.now(timezone.utc)

        route = device_exam_session_service.resolve_measurement_route(
            db,
            device_id=payload.device_id,
            requested_patient_id=payload.patient_id,
            requested_session_id=payload.session_id,
            measurement_type=DeviceExamMeasurementType.lung_sound,
            received_at=server_received_at,
            allow_patient_fallback=False,
            allow_unmatched=True,
        )
        resolved_patient_id = route.patient_id
        resolved_session_id = route.session_id

        if resolved_patient_id is not None:
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

        record = LungSoundRecord(
            patient_id=resolved_patient_id,
            device_exam_session_id=resolved_session_id,
            device_id=payload.device_id,
            routing_status=route.routing_status,
            conflict_metadata=route.conflict_metadata,
            position=payload.position,
            blob_url=payload.blob_url,
            storage_key=payload.storage_key,
            mime_type=payload.mime_type,
            duration_seconds=payload.duration_seconds,
            sample_rate_hz=payload.sample_rate_hz,
            channel_count=payload.channel_count,
            wheeze_score=payload.wheeze_score,
            crackle_score=payload.crackle_score,
            analysis=payload.analysis,
            recorded_at=recorded_at,
            server_received_at=server_received_at,
        )
        try:
            db.add(record)
            device_exam_session_service.touch_session_last_seen(
                db,
                session_id=resolved_session_id,
                device_id=payload.device_id,
                seen_at=recorded_at,
            )
            db.commit()
            db.refresh(record)
        except IntegrityError:
            db.rollback()
            existing = db.query(LungSoundRecord).filter(
                LungSoundRecord.device_id == payload.device_id,
                LungSoundRecord.recorded_at == recorded_at,
                LungSoundRecord.position == payload.position,
            ).first()
            if existing:
                return existing
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Database integrity error",
            )

        if resolved_session_id is not None and route.routing_status == DeviceMeasurementRoutingStatus.verified:
            publish_device_session_event_sync(
                event_type="device_session.measurement_received",
                session=device_exam_session_service.get_session(db, session_id=resolved_session_id),
                extra={"source": "lung_sound_ingest", "measurement_id": str(record.id)},
            )
        elif resolved_session_id is not None and route.routing_status == DeviceMeasurementRoutingStatus.needs_review:
            publish_device_session_event_sync(
                event_type="device_session.measurement_flagged",
                session=device_exam_session_service.get_session(db, session_id=resolved_session_id),
                extra={
                    "source": "lung_sound_ingest",
                    "measurement_id": str(record.id),
                    "routing_status": route.routing_status.value,
                },
            )
        return record

    def serialize_lung_sound_record(self, record: LungSoundRecord) -> LungSoundRecordOut:
        return LungSoundRecordOut.model_validate(record)


lung_sound_service = LungSoundService()
