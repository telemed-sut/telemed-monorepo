import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.limiter import limiter, get_failed_login_key
from app.core.security import get_password_hash
from app.models.audit_log import AuditLog
from app.models.user import User
from app.schemas.auth import (
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    InviteAcceptRequest,
    InviteInfoResponse,
    LoginRequest,
    MessageResponse,
    ResetPasswordRequest,
    TokenResponse,
    UserMeResponse,
)
from app.services import auth as auth_service
from app.services import security as security_service

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)


@router.get("/me", response_model=UserMeResponse)
def get_me(current_user: User = Depends(auth_service.get_current_user)):
    """Get current authenticated user's profile"""
    return UserMeResponse(
        id=str(current_user.id),
        email=current_user.email,
        first_name=current_user.first_name,
        last_name=current_user.last_name,
        role=current_user.role.value,
        verification_status=current_user.verification_status.value if current_user.verification_status else None,
    )


@router.post("/login", response_model=TokenResponse)
@limiter.limit("60/minute")  # General limit (e.g. successful logins from same IP)
@limiter.limit("10/minute", key_func=get_failed_login_key)  # Strict IP limit for brute-force protection
def login(request: Request, payload: LoginRequest, db: Session = Depends(auth_service.get_db)):
    # Prioritize Cloudflare header
    ip = request.headers.get("cf-connecting-ip")
    if not ip:
        ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "unknown")

    # Check if IP is banned
    ban = security_service.check_ip_banned(db, ip)
    if ban:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your IP has been temporarily blocked due to too many failed login attempts.",
        )

    # Look up user to check account lock
    stmt = select(User).where(User.email == payload.email, User.deleted_at.is_(None))
    user = db.scalar(stmt)

    # Check if account is locked
    locked_until = security_service.check_account_locked(user)
    if locked_until:
        raise HTTPException(
            status_code=423,
            detail=f"Account is locked due to too many failed attempts. Try again after {locked_until.strftime('%H:%M:%S UTC')}.",
        )

    # Attempt authentication
    authenticated_user = auth_service.authenticate_user(db, payload.email, payload.password)

    if not authenticated_user:
        # Record failed attempt
        security_service.handle_failed_login(db, ip, payload.email, user)

        # Log to audit
        audit_entry = AuditLog(
            user_id=user.id if user else None,
            action="login_failed",
            resource_type="user",
            resource_id=user.id if user else None,
            details=f"Failed login attempt for {payload.email} from IP {ip}",
            ip_address=ip,
            is_break_glass=False,
        )
        db.add(audit_entry)
        db.commit()

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Successful login
    security_service.handle_successful_login(db, ip, authenticated_user)
    db.commit()

    return auth_service.create_login_response(authenticated_user)


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("60/minute")
def refresh_token(
    request: Request,
    current_user: User = Depends(auth_service.get_current_user),
):
    """Refresh access token for authenticated user"""
    return auth_service.create_login_response(current_user)


@router.post("/logout")
@limiter.limit("60/minute")
def logout(
    request: Request,
    current_user: User = Depends(auth_service.get_current_user),
):
    """Logout endpoint (stateless JWT - client should discard token)"""
    return {"message": "Successfully logged out"}


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
@limiter.limit("10/minute")
def forgot_password(request: Request, payload: ForgotPasswordRequest, db: Session = Depends(auth_service.get_db)):
    """
    Request a password reset token.
    Always returns success to avoid leaking which emails exist.
    """
    user = db.scalar(select(User).where(User.email == payload.email))
    reset_token = None
    if user:
        reset_token = auth_service.create_password_reset_token(user)
        logger.info("Password reset requested for user_id=%s", user.id)

    response = ForgotPasswordResponse(
        message="If the account exists, a reset instruction has been generated.",
    )
    settings = get_settings()
    if settings.password_reset_return_token_in_response and reset_token:
        response.reset_token = reset_token

    return response


@router.post("/reset-password", response_model=MessageResponse)
@limiter.limit("20/minute")
def reset_password(request: Request, payload: ResetPasswordRequest, db: Session = Depends(auth_service.get_db)):
    user_id = auth_service.verify_password_reset_token(payload.token)
    try:
        parsed_user_id = UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid reset token")

    user = db.scalar(select(User).where(User.id == parsed_user_id))
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid reset token")

    auth_service.reset_user_password(db, user, payload.new_password)
    return MessageResponse(message="Password reset successful")


@router.get("/invite/{token}", response_model=InviteInfoResponse)
@limiter.limit("60/minute")
def get_invite_info(request: Request, token: str, db: Session = Depends(auth_service.get_db)):
    invite = auth_service.get_active_invite_by_token(db, token)
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite link is invalid or expired")

    return InviteInfoResponse(email=invite.email, role=invite.role, expires_at=invite.expires_at)


@router.post("/invite/accept", response_model=MessageResponse)
@limiter.limit("20/minute")
def accept_invite(request: Request, payload: InviteAcceptRequest, db: Session = Depends(auth_service.get_db)):
    invite = auth_service.get_active_invite_by_token(db, payload.token)
    if not invite:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invite link is invalid or expired")

    existing_user = db.scalar(select(User).where(User.email == invite.email))
    if existing_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This invite email is already registered")

    user = User(
        email=invite.email,
        password_hash=get_password_hash(payload.password),
        first_name=payload.first_name,
        last_name=payload.last_name,
        role=invite.role,
        license_no=payload.license_no,
    )
    db.add(user)
    auth_service.consume_invite(db, invite)
    return MessageResponse(message="Account created successfully")
