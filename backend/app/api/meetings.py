from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.limiter import limiter
from app.models.enums import MeetingStatus, UserRole
from app.models.user import User
from app.schemas.meeting import MeetingCreate, MeetingListResponse, MeetingOut, MeetingUpdate
from app.schemas.meeting_video import (
    MeetingPatientInviteRequest,
    MeetingPatientInviteResponse,
    MeetingPatientPresenceRequest,
    MeetingReliabilitySnapshotResponse,
    MeetingRoomPresenceResponse,
    MeetingPatientTokenRequest,
    MeetingVideoTokenRequest,
    MeetingVideoTokenResponse,
)
from app.services import auth as auth_service
from app.services import meeting as meeting_service
from app.services import meeting_presence as meeting_presence_service
from app.services import meeting_video as meeting_video_service

router = APIRouter(prefix="/meetings", tags=["meetings"])
settings = get_settings()

get_current_user = auth_service.get_current_user
get_admin_user = auth_service.get_admin_user


def _resolve_patient_join_meeting_id(
    *,
    db: Session,
    meeting_id: str | None,
    invite_token: str | None,
    short_code: str | None,
) -> str:
    normalized_requested_meeting_id = (
        meeting_video_service.normalize_meeting_id_text(meeting_id or "")
        if meeting_id
        else ""
    )

    if short_code:
        resolved_meeting_id = meeting_video_service.extract_meeting_id_from_patient_short_code(
            db,
            short_code,
        )
        if (
            normalized_requested_meeting_id
            and normalized_requested_meeting_id != resolved_meeting_id
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Patient short code does not match meeting_id.",
            )
        return resolved_meeting_id

    resolved_meeting_id = meeting_video_service.extract_meeting_id_from_patient_invite_token(
        invite_token or ""
    )
    if (
        normalized_requested_meeting_id
        and normalized_requested_meeting_id != resolved_meeting_id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Patient invite token does not match meeting_id.",
        )
    return resolved_meeting_id


def _presence_response(meeting, presence) -> MeetingRoomPresenceResponse:
    return MeetingRoomPresenceResponse(
        meeting_id=str(meeting.id),
        state=presence.state,
        doctor_online=presence.doctor_online,
        patient_online=presence.patient_online,
        refreshed_at=presence.refreshed_at,
        doctor_last_seen_at=presence.doctor_last_seen_at,
        patient_last_seen_at=presence.patient_last_seen_at,
        doctor_left_at=presence.doctor_left_at,
        patient_left_at=presence.patient_left_at,
        updated_at=presence.updated_at,
    )


def _ensure_doctor_can_view_meeting(
    *,
    db: Session,
    current_user: User,
    meeting,
) -> None:
    if not auth_service.can_view_clinical_data(current_user.role):
        raise HTTPException(status_code=403, detail="Access denied")

    if current_user.role != UserRole.admin and not meeting_service.can_assigned_user_view_meeting(
        db=db,
        user_id=current_user.id,
        meeting=meeting,
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only access meetings you own or assigned patients.",
        )


@router.post("", response_model=MeetingOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_meeting(
    request: Request,
    payload: MeetingCreate,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new meeting/appointment (admin or doctor)."""
    if current_user.role not in (UserRole.admin, UserRole.doctor):
        raise HTTPException(status_code=403, detail="Access denied")

    # Doctors always create meetings under their own account.
    if current_user.role == UserRole.doctor:
        payload.doctor_id = current_user.id

    meeting = meeting_service.create_meeting(db, payload)
    return meeting


@router.get("", response_model=MeetingListResponse)
@limiter.limit("60/minute")
def list_meetings(
    request: Request,
    page: int = Query(default=settings.default_page, ge=1),
    limit: int = Query(default=settings.default_limit, ge=1),
    q: Optional[str] = Query(default=None, description="Search in description, note, room"),
    doctor_id: Optional[str] = Query(default=None, description="Filter by doctor ID"),
    patient_id: Optional[str] = Query(default=None, description="Filter by patient ID"),
    status: Optional[str] = Query(default=None, description="Filter by status (scheduled, waiting, in_progress, overtime, completed, cancelled)"),
    sort: str = Query(default="date_time", pattern="^(date_time|created_at|updated_at|room|status)$"),
    order: str = Query(default="desc", pattern="^(asc|desc)$"),
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(get_current_user),
):
    """List meetings with pagination and filters."""
    if not auth_service.can_view_clinical_data(current_user.role):
        raise HTTPException(status_code=403, detail="Access denied")

    visible_doctor_id = current_user.id if current_user.role != UserRole.admin else None

    items, total = meeting_service.list_meetings(
        db, page, min(limit, settings.max_limit), q, doctor_id, patient_id, sort, order,
        status_filter=status,
        visible_doctor_id=visible_doctor_id,
    )

    reconciled_meetings = []
    for meeting in items:
        if meeting.status not in (MeetingStatus.waiting, MeetingStatus.in_progress):
            continue
        presence = meeting.room_presence
        if not presence:
            continue
        if meeting_presence_service.reconcile_active_meeting_status(db, meeting, presence):
            reconciled_meetings.append(meeting)

    if reconciled_meetings:
        db.commit()
        for meeting in reconciled_meetings:
            db.refresh(meeting)

    return MeetingListResponse(items=items, page=page, limit=min(limit, settings.max_limit), total=total)


@router.get("/{meeting_id}", response_model=MeetingOut)
@limiter.limit("60/minute")
def get_meeting(
    request: Request,
    meeting_id: str,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(get_current_user),
):
    """Get meeting by ID."""
    if not auth_service.can_view_clinical_data(current_user.role):
        raise HTTPException(status_code=403, detail="Access denied")
    meeting = meeting_service.get_meeting(db, meeting_id)
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")

    if current_user.role != UserRole.admin and not meeting_service.can_assigned_user_view_meeting(
        db=db,
        user_id=current_user.id,
        meeting=meeting,
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only access meetings you own or assigned patients.",
        )

    if meeting.room_presence and meeting_presence_service.reconcile_active_meeting_status(
        db,
        meeting,
        meeting.room_presence,
    ):
        db.commit()
        db.refresh(meeting)

    return meeting


@router.post("/{meeting_id}/video/token", response_model=MeetingVideoTokenResponse)
@limiter.limit("30/minute")
def issue_meeting_video_token(
    request: Request,
    meeting_id: str,
    payload: MeetingVideoTokenRequest,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(get_current_user),
):
    """Issue a short-lived meeting video token for authorized care-team users."""
    if current_user.role not in (UserRole.admin, UserRole.doctor):
        raise HTTPException(status_code=403, detail="Access denied")

    meeting = meeting_service.get_meeting(db, meeting_id)
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")

    _ensure_doctor_can_view_meeting(db=db, current_user=current_user, meeting=meeting)

    response = meeting_video_service.issue_meeting_video_token(
        meeting=meeting,
        current_user=current_user,
        expires_in_seconds=payload.expires_in_seconds,
    )
    return response


@router.get(
    "/{meeting_id}/video/reliability",
    response_model=MeetingReliabilitySnapshotResponse,
)
@limiter.limit("120/minute")
def get_meeting_video_reliability(
    request: Request,
    meeting_id: str,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(get_current_user),
):
    if not auth_service.can_view_clinical_data(current_user.role):
        raise HTTPException(status_code=403, detail="Access denied")

    meeting = meeting_service.get_meeting(db, meeting_id)
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")

    _ensure_doctor_can_view_meeting(db=db, current_user=current_user, meeting=meeting)

    presence = meeting.room_presence
    status_before_reconcile = meeting.status
    if presence and meeting_presence_service.reconcile_active_meeting_status(
        db,
        meeting,
        presence,
    ):
        db.commit()
        db.refresh(meeting)
        presence = meeting.room_presence

    return MeetingReliabilitySnapshotResponse(
        **meeting_presence_service.build_reliability_snapshot(
            meeting=meeting,
            presence=presence,
            meeting_status_before_reconcile=status_before_reconcile,
        )
    )


@router.post(
    "/{meeting_id}/video/patient-invite",
    response_model=MeetingPatientInviteResponse,
)
@limiter.limit("20/minute")
def create_patient_meeting_invite(
    request: Request,
    meeting_id: str,
    payload: MeetingPatientInviteRequest,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a signed invite URL/token that allows a patient app to join this meeting."""
    if current_user.role not in (UserRole.admin, UserRole.doctor):
        raise HTTPException(status_code=403, detail="Access denied")

    meeting = meeting_service.get_meeting(db, meeting_id)
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")

    if current_user.role == UserRole.doctor and not meeting_service.can_doctor_view_meeting(
        db=db,
        doctor_id=current_user.id,
        meeting=meeting,
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only access meetings you own or assigned patients.",
        )

    return meeting_video_service.create_patient_join_invite(
        db=db,
        meeting=meeting,
        created_by_user_id=str(current_user.id),
        expires_in_seconds=payload.expires_in_seconds,
    )


@router.post("/video/patient/token", response_model=MeetingVideoTokenResponse)
@limiter.limit("30/minute")
def issue_patient_video_token(
    request: Request,
    payload: MeetingPatientTokenRequest,
    db: Session = Depends(auth_service.get_db),
):
    """Exchange a signed patient invite token for a short-lived meeting video token."""
    resolved_meeting_id = _resolve_patient_join_meeting_id(
        db=db,
        meeting_id=payload.meeting_id,
        invite_token=payload.invite_token,
        short_code=payload.short_code,
    )

    meeting = meeting_service.get_meeting(db, resolved_meeting_id)
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")

    if payload.short_code:
        response = meeting_video_service.issue_patient_meeting_video_token_by_short_code(
            db=db,
            meeting=meeting,
            short_code=payload.short_code,
            expires_in_seconds=payload.expires_in_seconds,
        )
    else:
        response = meeting_video_service.issue_patient_meeting_video_token(
            meeting=meeting,
            invite_token=payload.invite_token or "",
            expires_in_seconds=payload.expires_in_seconds,
        )
    return response


@router.post("/{meeting_id}/video/presence/heartbeat", response_model=MeetingRoomPresenceResponse)
@limiter.limit("120/minute")
def doctor_presence_heartbeat(
    request: Request,
    meeting_id: str,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in (UserRole.admin, UserRole.doctor):
        raise HTTPException(status_code=403, detail="Access denied")

    meeting = meeting_service.get_meeting(db, meeting_id)
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")

    if current_user.role == UserRole.doctor and not meeting_service.can_doctor_view_meeting(
        db=db,
        doctor_id=current_user.id,
        meeting=meeting,
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only access meetings you own or assigned patients.",
        )

    presence = meeting_presence_service.touch_doctor_presence(db, meeting)
    if meeting_presence_service.reconcile_active_meeting_status(db, meeting, presence):
        db.commit()
        db.refresh(meeting)
        presence = meeting.room_presence
    return _presence_response(meeting, presence)


@router.post("/{meeting_id}/video/presence/leave", response_model=MeetingRoomPresenceResponse)
@limiter.limit("120/minute")
def doctor_presence_leave(
    request: Request,
    meeting_id: str,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in (UserRole.admin, UserRole.doctor):
        raise HTTPException(status_code=403, detail="Access denied")

    meeting = meeting_service.get_meeting(db, meeting_id)
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")

    if current_user.role == UserRole.doctor and not meeting_service.can_doctor_view_meeting(
        db=db,
        doctor_id=current_user.id,
        meeting=meeting,
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only access meetings you own or assigned patients.",
        )

    presence = meeting_presence_service.mark_doctor_left(db, meeting)
    if meeting_presence_service.reconcile_active_meeting_status(db, meeting, presence):
        db.commit()
    return _presence_response(meeting, presence)


@router.post("/video/patient/presence/heartbeat", response_model=MeetingRoomPresenceResponse)
@limiter.limit("120/minute")
def patient_presence_heartbeat(
    request: Request,
    payload: MeetingPatientPresenceRequest,
    db: Session = Depends(auth_service.get_db),
):
    resolved_meeting_id = _resolve_patient_join_meeting_id(
        db=db,
        meeting_id=payload.meeting_id,
        invite_token=payload.invite_token,
        short_code=payload.short_code,
    )

    meeting = meeting_service.get_meeting(db, resolved_meeting_id)
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")

    presence = meeting_presence_service.touch_patient_presence(db, meeting)
    if meeting_presence_service.reconcile_active_meeting_status(db, meeting, presence):
        db.commit()
        db.refresh(meeting)
        presence = meeting.room_presence
    return _presence_response(meeting, presence)


@router.post("/video/patient/presence/leave", response_model=MeetingRoomPresenceResponse)
@limiter.limit("120/minute")
def patient_presence_leave(
    request: Request,
    payload: MeetingPatientPresenceRequest,
    db: Session = Depends(auth_service.get_db),
):
    resolved_meeting_id = _resolve_patient_join_meeting_id(
        db=db,
        meeting_id=payload.meeting_id,
        invite_token=payload.invite_token,
        short_code=payload.short_code,
    )

    meeting = meeting_service.get_meeting(db, resolved_meeting_id)
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")

    presence = meeting_presence_service.mark_patient_left(db, meeting)
    if meeting_presence_service.reconcile_active_meeting_status(db, meeting, presence):
        db.commit()
    return _presence_response(meeting, presence)


@router.put("/{meeting_id}", response_model=MeetingOut)
@limiter.limit("30/minute")
def update_meeting(
    request: Request,
    meeting_id: str,
    payload: MeetingUpdate,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(get_current_user),
):
    """Update meeting. Doctors can only update their own meetings."""
    if not auth_service.can_write_clinical_data(current_user.role):
        raise HTTPException(status_code=403, detail="Access denied")
    meeting = meeting_service.get_meeting(db, meeting_id)
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")

    if current_user.role == UserRole.doctor:
        if not meeting_service.can_doctor_edit_meeting(current_user.id, meeting):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Doctors can only update meetings they own.",
            )

        if payload.doctor_id and str(payload.doctor_id) != str(current_user.id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Doctors cannot reassign meetings to another doctor.",
            )

    updated = meeting_service.update_meeting(db, meeting, payload, actor_id=current_user.id)
    return updated


@router.delete("/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("20/minute")
def delete_meeting(
    request: Request,
    meeting_id: str,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(get_admin_user),
):
    """Delete meeting (admin only)"""
    meeting = meeting_service.get_meeting(db, meeting_id)
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")

    meeting_service.delete_meeting(db, meeting)
    return None
