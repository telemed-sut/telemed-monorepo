from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.limiter import limiter
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.meeting import MeetingCreate, MeetingListResponse, MeetingOut, MeetingUpdate
from app.services import auth as auth_service
from app.services import meeting as meeting_service

router = APIRouter(prefix="/meetings", tags=["meetings"])
settings = get_settings()

get_current_user = auth_service.get_current_user
get_admin_user = auth_service.get_admin_user


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
    if current_user.role not in (UserRole.admin, UserRole.doctor):
        raise HTTPException(status_code=403, detail="Access denied")

    visible_doctor_id = current_user.id if current_user.role == UserRole.doctor else None

    items, total = meeting_service.list_meetings(
        db, page, min(limit, settings.max_limit), q, doctor_id, patient_id, sort, order,
        status_filter=status,
        visible_doctor_id=visible_doctor_id,
    )
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

    return meeting


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
    if current_user.role not in (UserRole.admin, UserRole.doctor):
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
