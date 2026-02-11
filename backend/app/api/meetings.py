from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.user import User
from app.schemas.meeting import MeetingCreate, MeetingListResponse, MeetingOut, MeetingUpdate
from app.services import auth as auth_service
from app.services import meeting as meeting_service

router = APIRouter(prefix="/meetings", tags=["meetings"])
settings = get_settings()
limiter = Limiter(key_func=get_remote_address)


@router.post("", response_model=MeetingOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_meeting(
    request: Request,
    payload: MeetingCreate,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_admin_or_staff_user),
):
    """Create a new meeting/appointment (admin or staff)"""
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
    sort: str = Query(default="date_time", pattern="^(date_time|created_at|updated_at|room)$"),
    order: str = Query(default="desc", pattern="^(asc|desc)$"),
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_admin_or_staff_user),
):
    """List meetings with pagination and filters (admin or staff)"""
    items, total = meeting_service.list_meetings(
        db, page, min(limit, settings.max_limit), q, doctor_id, patient_id, sort, order
    )
    return MeetingListResponse(items=items, page=page, limit=min(limit, settings.max_limit), total=total)


@router.get("/{meeting_id}", response_model=MeetingOut)
@limiter.limit("60/minute")
def get_meeting(
    request: Request,
    meeting_id: str,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_admin_or_staff_user),
):
    """Get meeting by ID (admin or staff)"""
    meeting = meeting_service.get_meeting(db, meeting_id)
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    return meeting


@router.put("/{meeting_id}", response_model=MeetingOut)
@limiter.limit("30/minute")
def update_meeting(
    request: Request,
    meeting_id: str,
    payload: MeetingUpdate,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_admin_or_staff_user),
):
    """Update meeting (admin or staff)"""
    meeting = meeting_service.get_meeting(db, meeting_id)
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")

    updated = meeting_service.update_meeting(db, meeting, payload)
    return updated


@router.delete("/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("20/minute")
def delete_meeting(
    request: Request,
    meeting_id: str,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_admin_user),
):
    """Delete meeting (admin only)"""
    meeting = meeting_service.get_meeting(db, meeting_id)
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")

    meeting_service.delete_meeting(db, meeting)
    return None
