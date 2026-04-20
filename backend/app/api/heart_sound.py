import time
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.pressure import log_device_error, verify_device_signature
from app.core.limiter import limiter
from app.core.request_utils import get_client_ip
from app.models.user import User
from app.schemas.heart_sound import (
    HeartSoundCreate,
    HeartSoundIngestResponse,
    HeartSoundRecordOut,
    HeartSoundUploadFinalize,
    HeartSoundUploadSessionCreate,
    HeartSoundUploadSessionOut,
    HeartSoundStorageAuditRecordOut,
    HeartSoundStorageAuditResponse,
)
from app.services import audit as audit_service
from app.services.auth import get_admin_user, get_db, verify_patient_access, verify_patient_access_doctor
from app.services.blob_storage import BlobStorageConfigurationError, azure_blob_storage_service
from app.services.heart_sound import heart_sound_service
from app.services.heart_sound_upload_sessions import (
    create_upload_session,
    delete_upload_session,
    get_upload_session,
)
from app.services.heart_sound_storage_audit import heart_sound_storage_audit_service

router = APIRouter()
MAX_HEART_SOUND_UPLOAD_BYTES = 50 * 1024 * 1024
HEART_SOUND_UPLOAD_SESSION_TTL_SECONDS = 15 * 60
MANUAL_UPLOAD_DEVICE_PREFIX = "doctor-upload"
MANUAL_UPLOAD_MAC_ADDRESS = "MANUAL_UPLOAD"
ALLOWED_AUDIO_EXTENSIONS = {".aac", ".m4a", ".mp3", ".ogg", ".wav", ".webm"}


class HeartSoundListPaginatedResponse(BaseModel):
    items: list[HeartSoundRecordOut]
    total: int
    limit: int
    offset: int


def _is_supported_audio_upload(file: UploadFile) -> bool:
    filename = (file.filename or "").strip().lower()
    content_type = (file.content_type or "").strip().lower()
    return _is_supported_audio_upload_metadata(filename=filename, content_type=content_type)


def _is_supported_audio_upload_metadata(*, filename: str, content_type: str | None) -> bool:
    normalized_filename = (filename or "").strip().lower()
    normalized_content_type = (content_type or "").strip().lower()
    if normalized_content_type.startswith("audio/"):
        return True
    return any(normalized_filename.endswith(extension) for extension in ALLOWED_AUDIO_EXTENSIONS)


def _parse_optional_recorded_at(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


@router.post("/device/v1/heart-sounds", response_model=HeartSoundIngestResponse, status_code=201)
@limiter.limit("60/minute")
def create_heart_sound_record(
    request: Request,
    *,
    db: Session = Depends(get_db),
    heart_sound_in: HeartSoundCreate,
    authorized: bool = Depends(verify_device_signature),
) -> Any:
    try:
        if heart_sound_in.recorded_at is None:
            signed_ts = getattr(request.state, "device_request_timestamp", int(time.time()))
            heart_sound_in = heart_sound_in.model_copy(
                update={"recorded_at": datetime.fromtimestamp(signed_ts, tz=timezone.utc)}
            )

        device_id = (request.headers.get("x-device-id") or "").strip()
        if not device_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Missing X-Device-Id header",
            )

        record = heart_sound_service.create_heart_sound(
            db,
            payload=heart_sound_in,
            device_id=device_id,
        )
        return {"status": "ok", "record_id": record.id}
    except HTTPException as exc:
        log_device_error(
            db,
            (request.headers.get("x-device-id") or "unknown"),
            f"HTTP {exc.status_code}",
            request,
        )
        raise
    except Exception as exc:
        log_device_error(
            db,
            (request.headers.get("x-device-id") or "unknown"),
            f"INTERNAL_ERROR:{exc.__class__.__name__}",
            request,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error",
        )


@router.get("/patients/{patient_id}/heart-sounds", response_model=HeartSoundListPaginatedResponse)
@limiter.limit("60/minute")
def get_patient_heart_sounds(
    request: Request,
    patient_id: UUID,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(verify_patient_access),
):
    items, total = heart_sound_service.list_patient_heart_sounds(db, patient_id, limit=limit, offset=offset)
    audit_service.log_action(
        db,
        current_user.id,
        "view_patient_heart_sounds",
        resource_type="patient",
        resource_id=patient_id,
        ip_address=get_client_ip(request),
        details={"count": len(items)},
    )
    return {
        "items": [heart_sound_service.serialize_heart_sound_record(item) for item in items],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/heart-sounds/storage-consistency-audit", response_model=HeartSoundStorageAuditResponse)
@limiter.limit("15/minute")
def audit_heart_sound_storage_consistency(
    request: Request,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    mismatches_only: bool = Query(default=True),
    patient_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    try:
        summary = heart_sound_storage_audit_service.audit_records(
            db,
            limit=limit,
            offset=offset,
            patient_id=patient_id,
            mismatches_only=mismatches_only,
        )
    except BlobStorageConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    audit_service.log_action(
        db,
        current_user.id,
        "audit_heart_sound_storage_consistency",
        resource_type="heart_sound_record",
        resource_id=patient_id,
        ip_address=get_client_ip(request),
        details={
            "limit": limit,
            "offset": offset,
            "mismatches_only": mismatches_only,
            "scanned_count": summary.scanned_count,
            "inconsistent_count": summary.inconsistent_count,
            "issue_counts": summary.issue_counts,
        },
    )
    return {
        "items": [
            HeartSoundStorageAuditRecordOut(
                id=item.record.id,
                patient_id=item.record.patient_id,
                device_id=item.record.device_id,
                position=item.record.position,
                storage_key=item.record.storage_key,
                normalized_storage_key=item.normalized_storage_key,
                blob_url=item.record.blob_url,
                canonical_blob_url=item.canonical_blob_url,
                blob_exists=item.blob_exists,
                is_consistent=item.is_consistent,
                issues=item.issues,
                recorded_at=item.record.recorded_at,
                created_at=item.record.created_at,
            )
            for item in summary.items
        ],
        "total_records": summary.total_records,
        "scanned_count": summary.scanned_count,
        "inconsistent_count": summary.inconsistent_count,
        "issue_counts": summary.issue_counts,
        "limit": limit,
        "offset": offset,
    }


@router.post("/patients/{patient_id}/heart-sounds/upload", response_model=HeartSoundRecordOut, status_code=201)
@limiter.limit("30/minute")
def upload_patient_heart_sound(
    request: Request,
    patient_id: UUID,
    position: int = Form(..., ge=1, le=14),
    recorded_at: datetime | None = Form(default=None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(verify_patient_access_doctor),
):
    filename = (file.filename or "").strip()
    if not filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please choose an audio file to upload.",
        )

    if not _is_supported_audio_upload(file):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only audio files are allowed for heart-sound uploads.",
        )

    file_bytes = file.file.read()
    if not file_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )
    if len(file_bytes) > MAX_HEART_SOUND_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Heart-sound uploads must be 50 MB or smaller.",
        )

    try:
        uploaded_blob = azure_blob_storage_service.upload_heart_sound(
            patient_id=patient_id,
            filename=filename,
            content=file_bytes,
            content_type=file.content_type,
        )
    except BlobStorageConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to upload the file to Azure Blob Storage.",
        ) from exc

    try:
        record = heart_sound_service.create_heart_sound(
            db,
            payload=HeartSoundCreate(
                user_id=patient_id,
                mac_address=MANUAL_UPLOAD_MAC_ADDRESS,
                position=position,
                blob_url=uploaded_blob.blob_url,
                storage_key=uploaded_blob.storage_key,
                mime_type=file.content_type or "application/octet-stream",
                recorded_at=recorded_at,
            ),
            device_id=f"{MANUAL_UPLOAD_DEVICE_PREFIX}:{current_user.id}",
        )
    except Exception:
        azure_blob_storage_service.delete_blob(uploaded_blob.storage_key)
        raise

    audit_service.log_action(
        db,
        current_user.id,
        "upload_patient_heart_sound",
        resource_type="patient",
        resource_id=patient_id,
        ip_address=get_client_ip(request),
        details={
            "file_name": filename,
            "position": position,
            "size_bytes": len(file_bytes),
            "storage_key": uploaded_blob.storage_key,
        },
    )
    return heart_sound_service.serialize_heart_sound_record(record)


@router.post(
    "/patients/{patient_id}/heart-sounds/upload-session",
    response_model=HeartSoundUploadSessionOut,
    status_code=201,
)
@limiter.limit("60/minute")
def create_patient_heart_sound_upload_session(
    request: Request,
    patient_id: UUID,
    payload: HeartSoundUploadSessionCreate = Body(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(verify_patient_access_doctor),
):
    if payload.file_size_bytes > MAX_HEART_SOUND_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Heart-sound uploads must be 50 MB or smaller.",
        )

    if not _is_supported_audio_upload_metadata(
        filename=payload.filename,
        content_type=payload.mime_type,
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only audio files are allowed for heart-sound uploads.",
        )

    try:
        prepared_upload = azure_blob_storage_service.prepare_heart_sound_upload(
            patient_id=patient_id,
            filename=payload.filename,
            ttl_seconds=HEART_SOUND_UPLOAD_SESSION_TTL_SECONDS,
        )
    except BlobStorageConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to prepare an Azure Blob Storage upload session.",
        ) from exc

    session_payload = create_upload_session(
        patient_id=patient_id,
        user_id=current_user.id,
        position=payload.position,
        filename=payload.filename,
        blob_url=prepared_upload.blob_url,
        storage_key=prepared_upload.storage_key,
        mime_type=payload.mime_type,
        file_size_bytes=payload.file_size_bytes,
        recorded_at=payload.recorded_at,
        ttl_seconds=HEART_SOUND_UPLOAD_SESSION_TTL_SECONDS,
    )

    audit_service.log_action(
        db,
        current_user.id,
        "create_patient_heart_sound_upload_session",
        resource_type="patient",
        resource_id=patient_id,
        ip_address=get_client_ip(request),
        details={
            "file_name": payload.filename,
            "position": payload.position,
            "size_bytes": payload.file_size_bytes,
            "storage_key": prepared_upload.storage_key,
            "session_id": session_payload["session_id"],
        },
    )
    return {
        "session_id": session_payload["session_id"],
        "storage_key": prepared_upload.storage_key,
        "blob_url": prepared_upload.blob_url,
        "upload_url": prepared_upload.upload_url,
        "upload_headers": {
            "x-ms-blob-type": "BlockBlob",
            "x-ms-blob-content-type": payload.mime_type or "application/octet-stream",
            "Content-Type": payload.mime_type or "application/octet-stream",
        },
        "expires_at": prepared_upload.expires_at,
        "max_file_size_bytes": MAX_HEART_SOUND_UPLOAD_BYTES,
    }


@router.post(
    "/patients/{patient_id}/heart-sounds/complete-upload",
    response_model=HeartSoundRecordOut,
    status_code=201,
)
@limiter.limit("60/minute")
def complete_patient_heart_sound_upload(
    request: Request,
    patient_id: UUID,
    payload: HeartSoundUploadFinalize = Body(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(verify_patient_access_doctor),
):
    session = get_upload_session(payload.session_id)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The upload session was not found or has expired.",
        )

    if session["patient_id"] != str(patient_id) or session["user_id"] != str(current_user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This upload session does not belong to the current user or patient.",
        )

    if not azure_blob_storage_service.blob_exists(session["storage_key"]):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The audio file has not finished uploading to Azure Blob Storage yet.",
        )

    try:
        record = heart_sound_service.create_heart_sound(
            db,
            payload=HeartSoundCreate(
                user_id=patient_id,
                mac_address=MANUAL_UPLOAD_MAC_ADDRESS,
                position=session["position"],
                blob_url=session["blob_url"],
                storage_key=session["storage_key"],
                mime_type=session["mime_type"] or "application/octet-stream",
                recorded_at=_parse_optional_recorded_at(session["recorded_at"]),
            ),
            device_id=f"{MANUAL_UPLOAD_DEVICE_PREFIX}:{current_user.id}",
        )
    except Exception:
        azure_blob_storage_service.delete_blob(session["storage_key"])
        delete_upload_session(payload.session_id)
        raise

    delete_upload_session(payload.session_id)
    audit_service.log_action(
        db,
        current_user.id,
        "complete_patient_heart_sound_upload",
        resource_type="patient",
        resource_id=patient_id,
        ip_address=get_client_ip(request),
        details={
            "file_name": session["filename"],
            "position": session["position"],
            "size_bytes": session["file_size_bytes"],
            "storage_key": session["storage_key"],
            "session_id": payload.session_id,
        },
    )
    return heart_sound_service.serialize_heart_sound_record(record)
