"""Core authentication facade and access-control dependencies."""

import secrets
from datetime import timedelta
from typing import List, Optional
from uuid import UUID

from fastapi import Depends, HTTPException, Path, Request, status
from fastapi.security import OAuth2PasswordBearer
from jwt.exceptions import PyJWTError as JWTError
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import decode_token
from app.db.session import SessionLocal
from app.models.audit_log import AuditLog
from app.models.doctor_patient_assignment import DoctorPatientAssignment
from app.models.enums import UserRole
from app.models.user import User
from app.core.request_utils import get_client_ip
from app.services.authz import (
    can_manage_users,
    can_receive_patient_assignments,
    can_receive_user_invite,
    can_view_clinical_data,
    can_write_clinical_data,
    is_medical_student_role,
)
from app.services.auth_privileges import (
    backfill_bootstrap_privileged_roles,
    build_access_profile,
    can_manage_privileged_admins,
    can_manage_security_recovery,
    is_admin_sso_enforced_for_user,
    requires_token_mfa,
)
from app.services import auth_sessions
from app.services import patient as patient_service
from .auth_2fa import (
    get_request_auth_payload,
    require_recent_privileged_session,
    require_recent_sensitive_session,
)
from .auth_login import (
    authenticate_user,
    consume_invite,
    create_user_invite,
    get_active_invite_by_token,
    hash_invite_token,
    reset_user_password,
)
from .auth_tokens import (
    PasswordResetTokenClaims,
    _coerce_timestamp,
    _get_password_changed_marker,
    _normalize_dt,
    _now_utc,
    _validate_token_session,
    create_login_response,
    create_password_reset_token,
    get_access_token_ttl_seconds,
    is_password_reset_token_stale,
    is_recent_mfa_authenticated,
    parse_password_reset_token,
    verify_password_reset_token,
)

settings = get_settings()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    request: Request,
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    cookie_token = request.cookies.get(settings.auth_cookie_name)
    raw_token = token or cookie_token
    if not raw_token:
        raise credentials_exception

    # CSRF mitigation for cookie-based auth:
    # when authentication relies on cookies (not Bearer header),
    # validate request origin on state-changing methods.
    if token is None and cookie_token:
        _validate_cookie_csrf(request)

    try:
        payload = decode_token(raw_token)
        request.state.auth_payload = payload
        token_type = payload.get("type")
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
        if token_type not in (None, "access"):
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    try:
        uid = UUID(user_id)
    except (ValueError, AttributeError):
        raise credentials_exception

    stmt = select(User).where(User.id == uid, User.deleted_at.is_(None))
    user = db.scalar(stmt)
    if user is None:
        raise credentials_exception
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )
    _validate_token_session(user, payload, credentials_exception)
    auth_sessions.require_active_session(
        db,
        user_id=user.id,
        session_id=payload.get("session_id") if isinstance(payload, dict) else None,
        credentials_exception=credentials_exception,
    )
    return user


def get_optional_current_user(
    request: Request,
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> Optional[User]:
    raw_token = token or request.cookies.get(settings.auth_cookie_name)
    if not raw_token:
        return None

    try:
        payload = decode_token(raw_token)
        request.state.auth_payload = payload
        token_type = payload.get("type")
        user_id: str = payload.get("sub")
        if user_id is None:
            return None
        if token_type not in (None, "access"):
            return None
    except JWTError:
        return None

    try:
        uid = UUID(user_id)
    except (ValueError, AttributeError):
        return None

    user = db.scalar(select(User).where(User.id == uid, User.deleted_at.is_(None)))
    if user is None or not user.is_active:
        return None
    try:
        credentials_exception = HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
        _validate_token_session(user, payload, credentials_exception)
        auth_sessions.require_active_session(
            db,
            user_id=user.id,
            session_id=payload.get("session_id") if isinstance(payload, dict) else None,
            credentials_exception=credentials_exception,
        )
    except HTTPException:
        return None
    return user


def _validate_cookie_csrf(request: Request) -> None:
    safe_methods = {"GET", "HEAD", "OPTIONS", "TRACE"}
    if request.method.upper() in safe_methods:
        return

    def normalize_origin(value: str | None) -> str | None:
        if not value:
            return None
        normalized = value.strip().rstrip("/")
        if not normalized.startswith(("http://", "https://")):
            return None
        return normalized

    allowed_origins: set[str] = set()
    
    # Strictly allow ONLY configured origins. 
    # Do NOT trust incoming X-Forwarded-Host for origin validation.
    frontend_origin = normalize_origin(settings.frontend_base_url)
    if frontend_origin:
        allowed_origins.add(frontend_origin)

    raw_cors_origins = settings.cors_origins
    if isinstance(raw_cors_origins, str):
        cors_origins = [origin.strip() for origin in raw_cors_origins.split(",") if origin.strip()]
    else:
        cors_origins = [origin.strip() for origin in raw_cors_origins if origin and origin.strip()]

    for origin in cors_origins:
        normalized = normalize_origin(origin)
        if normalized:
            allowed_origins.add(normalized)
    
    csrf_cookie = request.cookies.get("csrf_token")
    csrf_header = request.headers.get("x-csrf-token")
    has_valid_csrf_token = bool(
        csrf_cookie
        and csrf_header
        and secrets.compare_digest(csrf_cookie, csrf_header)
    )

    origin = request.headers.get("origin")
    if origin:
        if allowed_origins and origin.rstrip("/") not in allowed_origins:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="CSRF validation failed.",
            )
        # Always require cryptographic token validation even if origin is correct.
        if has_valid_csrf_token:
            return

    referer = request.headers.get("referer")
    if referer:
        normalized_referer = referer.rstrip("/")
        for allowed_origin in allowed_origins:
            if normalized_referer == allowed_origin or normalized_referer.startswith(f"{allowed_origin}/"):
                # Always require cryptographic token validation even if referer is correct.
                if has_valid_csrf_token:
                    return
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF validation failed.",
        )

    if has_valid_csrf_token:
        return

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="CSRF validation failed.",
    )


def is_super_admin(user: Optional[User], db: Session | None = None) -> bool:
    return can_manage_privileged_admins(user, db)


def require_roles(allowed_roles: List[UserRole], *, require_mfa: bool = False):
    """Dependency to require specific roles and optionally a verified session."""
    def role_checker(
        request: Request,
        current_user: User = Depends(get_current_user)
    ) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required roles: {[role.value for role in allowed_roles]}"
            )
        
        if require_mfa:
            payload = get_request_auth_payload(request)
            if not payload.get("mfa_verified"):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Recent verification required for this action.",
                )
                
        return current_user
    return role_checker


# Common role dependencies
get_admin_user = require_roles([UserRole.admin], require_mfa=True)
get_clinical_user = require_roles([
    UserRole.admin,
    UserRole.doctor,
    UserRole.medical_student,
])
get_doctor_user = require_roles([UserRole.admin, UserRole.doctor])

# Break-glass session window (hours)
BREAK_GLASS_WINDOW_HOURS = 8


def _has_active_assignment(db: Session, user_id: UUID, patient_id: UUID) -> bool:
    """Check if a user has an active assignment to a patient."""
    exists = db.scalar(
        select(DoctorPatientAssignment.id).where(
            and_(
                DoctorPatientAssignment.doctor_id == user_id,
                DoctorPatientAssignment.patient_id == patient_id,
            )
        )
    )
    return exists is not None


def _has_active_break_glass(db: Session, user_id: UUID, patient_id: UUID) -> bool:
    """Check if there is a recent break-glass audit entry granting temporary access."""
    cutoff = _now_utc() - timedelta(hours=BREAK_GLASS_WINDOW_HOURS)
    exists = db.scalar(
        select(AuditLog.id).where(
            and_(
                AuditLog.user_id == user_id,
                AuditLog.resource_id == patient_id,
                AuditLog.action == "break_glass",
                AuditLog.is_break_glass == True,  # noqa: E712
                AuditLog.created_at >= cutoff,
            )
        )
    )
    return exists is not None


def verify_patient_access(
    request: Request,
    patient_id: UUID = Path(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_clinical_user),
) -> User:
    """Verify that the current care-team user is authorized to access this patient.

    - Admin: always allowed.
    - Doctor/medical student: must have an active assignment.
    """
    patient_service.verify_doctor_patient_access(
        db,
        current_user=current_user,
        patient_id=patient_id,
        ip_address=get_client_ip(request),
    )
    return current_user


def verify_patient_access_doctor(
    request: Request,
    patient_id: UUID = Path(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_doctor_user),
) -> User:
    """Same as verify_patient_access but restricted to doctor (+ admin) roles."""
    patient_service.verify_doctor_patient_access(
        db,
        current_user=current_user,
        patient_id=patient_id,
        ip_address=get_client_ip(request),
    )
    return current_user
