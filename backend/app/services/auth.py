import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, List, Optional
from uuid import UUID

from fastapi import Depends, HTTPException, Path, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token, decode_token, get_password_hash, verify_password
from app.db.session import SessionLocal
from app.models.audit_log import AuditLog
from app.models.doctor_patient_assignment import DoctorPatientAssignment
from app.models.invite import UserInvite
from app.models.enums import UserRole
from app.models.user import User
from app.services import patient as patient_service
from app.core.request_utils import get_client_ip

settings = get_settings()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)

SUPPORTED_PRIMARY_ROLES = frozenset({
    UserRole.admin,
    UserRole.doctor,
    UserRole.medical_student,
})
ASSIGNABLE_CARE_TEAM_ROLES = frozenset({
    UserRole.doctor,
    UserRole.medical_student,
})
CLINICAL_VIEW_ROLES = frozenset({
    UserRole.admin,
    UserRole.doctor,
    UserRole.medical_student,
})
CLINICAL_WRITE_ROLES = frozenset({
    UserRole.admin,
    UserRole.doctor,
})
INVITABLE_ROLES = frozenset({
    UserRole.admin,
    UserRole.doctor,
    UserRole.medical_student,
})


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def authenticate_user(db: Session, email: str, password: str) -> Optional[User]:
    stmt = select(User).where(User.email == email, User.deleted_at.is_(None))
    user = db.scalar(stmt)
    if user is None:
        return None
    if not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def requires_token_mfa(user: User | None) -> bool:
    if user is None:
        return False
    return (settings.admin_2fa_required and user.role == UserRole.admin) or bool(user.two_factor_enabled)


def create_login_response(user: User, *, mfa_verified: bool = True) -> dict:
    effective_mfa_verified = not requires_token_mfa(user) or bool(mfa_verified)
    token = create_access_token(
        {
            "sub": str(user.id),
            "role": user.role.value,
            "type": "access",
            "mfa_verified": effective_mfa_verified,
        }
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": settings.jwt_expires_in,
        "user": {
            "id": str(user.id),
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "role": user.role.value,
            "verification_status": user.verification_status.value if user.verification_status else None,
            "two_factor_enabled": bool(user.two_factor_enabled),
            "mfa_verified": effective_mfa_verified,
            "is_super_admin": is_super_admin(user),
        },
    }


def create_password_reset_token(user: User) -> str:
    payload = {
        "sub": str(user.id),
        "type": "password_reset",
    }
    return create_access_token(payload, expires_in=settings.password_reset_expires_in)


def verify_password_reset_token(token: str) -> str:
    credentials_exception = HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Invalid or expired reset token",
    )
    try:
        payload = decode_token(token)
        token_type = payload.get("type")
        user_id = payload.get("sub")
        if token_type != "password_reset" or not user_id:
            raise credentials_exception
        return str(user_id)
    except JWTError:
        raise credentials_exception


def reset_user_password(db: Session, user: User, new_password: str) -> None:
    user.password_hash = get_password_hash(new_password)
    user.password_changed_at = _now_utc()
    db.add(user)
    db.flush()


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def hash_invite_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_user_invite(
    db: Session,
    *,
    email: str,
    role: UserRole,
    expires_in_hours: int,
    created_by: User,
) -> tuple[str, UserInvite]:
    raw_token = secrets.token_urlsafe(32)
    token_hash = hash_invite_token(raw_token)
    now = _now_utc()
    expires_at = now + timedelta(hours=expires_in_hours)

    # Invalidate previous active invites for the same email.
    existing_invites = db.scalars(
        select(UserInvite).where(
            and_(
                UserInvite.email == email.lower(),
                UserInvite.used_at.is_(None),
                UserInvite.expires_at > now,
            )
        )
    ).all()
    for existing_invite in existing_invites:
        existing_invite.used_at = now
        db.add(existing_invite)

    invite = UserInvite(
        token_hash=token_hash,
        email=email.lower(),
        role=role,
        expires_at=expires_at,
        created_by=created_by.id,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return raw_token, invite


def can_manage_users(role: UserRole | None) -> bool:
    return role == UserRole.admin


def can_view_clinical_data(role: UserRole | None) -> bool:
    return role in CLINICAL_VIEW_ROLES


def can_write_clinical_data(role: UserRole | None) -> bool:
    return role in CLINICAL_WRITE_ROLES


def can_receive_patient_assignments(role: UserRole | None) -> bool:
    return role in ASSIGNABLE_CARE_TEAM_ROLES


def can_receive_user_invite(role: UserRole | None) -> bool:
    return role in INVITABLE_ROLES


def is_medical_student_role(role: UserRole | None) -> bool:
    return role == UserRole.medical_student


def _normalize_dt(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def get_active_invite_by_token(db: Session, token: str) -> Optional[UserInvite]:
    token_hash = hash_invite_token(token)
    invite = db.scalar(select(UserInvite).where(UserInvite.token_hash == token_hash))
    if not invite:
        return None
    if invite.used_at is not None:
        return None
    if _normalize_dt(invite.expires_at) <= _now_utc():
        return None
    return invite


def consume_invite(db: Session, invite: UserInvite) -> None:
    invite.used_at = _now_utc()
    db.add(invite)
    db.commit()


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
    except HTTPException:
        return None
    return user


def _coerce_timestamp(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return _normalize_dt(value)
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc)
    return None


def _validate_token_session(
    user: User,
    payload: dict[str, Any],
    credentials_exception: HTTPException,
) -> None:
    token_issued_at = _coerce_timestamp(payload.get("iat"))
    password_changed_at = _normalize_dt(user.password_changed_at) if user.password_changed_at else None
    if password_changed_at is not None:
        if token_issued_at is None or token_issued_at < password_changed_at:
            raise credentials_exception

    if requires_token_mfa(user) and not bool(payload.get("mfa_verified")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Two-factor verification required",
            headers={"WWW-Authenticate": "Bearer"},
        )


def _validate_cookie_csrf(request: Request) -> None:
    safe_methods = {"GET", "HEAD", "OPTIONS", "TRACE"}
    if request.method.upper() in safe_methods:
        return

    allowed_origins: set[str] = set()
    frontend_origin = settings.frontend_base_url.rstrip("/")
    if frontend_origin:
        allowed_origins.add(frontend_origin)

    raw_cors_origins = settings.cors_origins
    if isinstance(raw_cors_origins, str):
        cors_origins = [origin.strip() for origin in raw_cors_origins.split(",") if origin.strip()]
    else:
        cors_origins = [origin.strip() for origin in raw_cors_origins if origin and origin.strip()]

    for origin in cors_origins:
        normalized = origin.rstrip("/")
        if normalized.startswith("http://") or normalized.startswith("https://"):
            allowed_origins.add(normalized)

    if not allowed_origins:
        return

    origin = request.headers.get("origin")
    if origin:
        if origin.rstrip("/") not in allowed_origins:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="CSRF validation failed.",
            )
        return

    referer = request.headers.get("referer")
    if referer:
        normalized_referer = referer.rstrip("/")
        for allowed_origin in allowed_origins:
            if normalized_referer == allowed_origin or normalized_referer.startswith(f"{allowed_origin}/"):
                return
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF validation failed.",
        )

    # Non-browser clients may omit origin/referer.
    return


def is_super_admin(user: Optional[User]) -> bool:
    if not user:
        return False
    if user.role != UserRole.admin:
        return False

    raw_super_admins = settings.super_admin_emails
    if isinstance(raw_super_admins, str):
        super_admins = {email.strip().lower() for email in raw_super_admins.split(",") if email.strip()}
    else:
        super_admins = {email.strip().lower() for email in raw_super_admins if email and email.strip()}

    return user.email.lower() in super_admins


def require_roles(allowed_roles: List[UserRole]):
    """Dependency to require specific roles"""
    def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required roles: {[role.value for role in allowed_roles]}"
            )
        return current_user
    return role_checker


# Common role dependencies
get_admin_user = require_roles([UserRole.admin])
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
