import logging
from datetime import datetime, timezone
from urllib.parse import urlencode
from uuid import UUID

import anyio
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.limiter import (
    limiter,
    get_strict_client_ip_rate_limit_key,
    get_strict_failed_login_key,
)
from app.core.security import (
    create_access_token,
    decode_token,
    generate_security_token,
    get_password_hash,
    verify_password,
)
from app.models.audit_log import AuditLog
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.auth import (
    AccessProfileResponse,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    InviteAcceptRequest,
    InviteInfoResponse,
    InviteTokenRequest,
    LoginRequest,
    MessageResponse,
    ResetPasswordRequest,
    StepUpAuthRequest,
    TokenResponse,
    UserMeResponse,
)
from app.schemas.user import CLINICAL_ROLES
from app.services import auth as auth_service
from app.services import auth_sessions
from app.services import admin_sso_store
from app.services import security as security_service
from app.services.user_events import publish_user_registered

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)
settings = get_settings()
ADMIN_SSO_STATE_COOKIE = "admin_sso_state"
CSRF_COOKIE_NAME = "csrf_token"


def _frontend_url_for(path: str = "/login") -> str:
    base = get_settings().frontend_base_url.rstrip("/")
    if not path.startswith("/"):
        path = f"/{path}"
    return f"{base}{path}"


def _admin_sso_metadata_endpoint(issuer: str | None) -> str | None:
    if not issuer:
        return None
    normalized_issuer = issuer.rstrip("/")
    return f"{normalized_issuer}/.well-known/openid-configuration"


def _log_admin_sso_event(
    message: str,
    *,
    level: int = logging.INFO,
    event: str,
    reason: str | None = None,
    provider: str | None = None,
    email: str | None = None,
    mfa_verified: bool | None = None,
    exc_info: bool = False,
    **extra_fields: object,
) -> None:
    extra = {
        "event": event,
        "reason": reason,
        "provider": provider,
        "email": email,
        "mfa_verified": mfa_verified,
        **extra_fields,
    }
    logger.log(level, message, extra=extra, exc_info=exc_info)


def _retired_email(user_id: UUID) -> str:
    """Generate a unique placeholder email for soft-deleted users."""
    return f"deleted+{user_id.hex}@archive.example.com"


def _set_auth_cookie(response: Response, access_token: str, *, max_age_seconds: int) -> None:
    response.set_cookie(
        key=settings.auth_cookie_name,
        value=access_token,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite=settings.auth_cookie_samesite,
        max_age=max_age_seconds,
        path="/",
    )


def _set_csrf_cookie(
    response: Response,
    *,
    max_age_seconds: int,
    token: str | None = None,
) -> str:
    csrf_token = token or generate_security_token()
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=csrf_token,
        httponly=False,
        secure=settings.auth_cookie_secure,
        samesite=settings.auth_cookie_samesite,
        max_age=max_age_seconds,
        path="/",
    )
    return csrf_token


def _clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.auth_cookie_name,
        path="/",
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite=settings.auth_cookie_samesite,
    )


def _clear_csrf_cookie(response: Response) -> None:
    response.delete_cookie(
        key=CSRF_COOKIE_NAME,
        path="/",
        httponly=False,
        secure=settings.auth_cookie_secure,
        samesite=settings.auth_cookie_samesite,
    )


def _set_admin_sso_state_cookie(response: Response, state_token: str) -> None:
    oidc_settings = get_settings()
    response.set_cookie(
        key=ADMIN_SSO_STATE_COOKIE,
        value=state_token,
        httponly=True,
        secure=oidc_settings.auth_cookie_secure,
        samesite="lax",
        max_age=oidc_settings.admin_oidc_state_ttl_seconds,
        path="/",
    )


def _get_admin_sso_state_cookie(request: Request) -> str | None:
    return request.cookies.get(ADMIN_SSO_STATE_COOKIE)


def _clear_admin_sso_state_cookie(response: Response) -> None:
    oidc_settings = get_settings()
    response.delete_cookie(
        key=ADMIN_SSO_STATE_COOKIE,
        path="/",
        httponly=True,
        secure=oidc_settings.auth_cookie_secure,
        samesite="lax",
    )


# Use shared utility for consistent IP extraction across all routes.
from app.core.request_utils import get_client_ip as _client_ip  # noqa: E402


def _account_locked_detail(locked_until: datetime) -> dict[str, object]:
    now = datetime.now(timezone.utc)
    remaining_seconds = max(0, int((locked_until - now).total_seconds()))
    return {
        "code": "ACCOUNT_LOCKED",
        "message": "Account temporarily locked due to multiple failed login attempts.",
        "retry_after_seconds": remaining_seconds,
    }


def _lock_recovery_options_for_user(user: User | None) -> list[str]:
    if user and user.role == UserRole.admin:
        return ["wait", "contact_security_admin"]
    return ["wait", "forgot_password", "contact_admin"]


def _build_account_locked_detail(
    locked_until: datetime,
    *,
    user: User | None,
) -> dict[str, object]:
    detail = _account_locked_detail(locked_until)
    detail["code"] = str(detail["code"]).lower()
    detail["recovery_options"] = _lock_recovery_options_for_user(user)
    return detail


def _write_auth_audit(
    db: Session,
    *,
    action: str,
    ip_address: str,
    status_value: str,
    user: User | None = None,
    resource_type: str = "user",
    resource_id: UUID | None = None,
    details: dict | str | None = None,
) -> None:
    db.add(
        AuditLog(
            user_id=user.id if user else None,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id if resource_id is not None else (user.id if user else None),
            details=details,
            ip_address=ip_address,
            is_break_glass=False,
            status=status_value,
        )
    )


def _complete_local_login(
    response: Response,
    *,
    db: Session,
    user: User,
    ip_address: str,
):
    security_service.handle_successful_login(db, ip_address, user)

    _write_auth_audit(
        db,
        action="login_success",
        ip_address=ip_address,
        status_value="success",
        user=user,
        details={
            "auth_source": "local",
            "mfa_verified": True,
        },
    )
    login_response = auth_service.create_login_response(
        user,
        db=db,
        mfa_verified=True,
        mfa_authenticated_at=datetime.now(timezone.utc),
    )
    db.commit()
    _set_auth_cookie(
        response,
        login_response["access_token"],
        max_age_seconds=login_response["expires_in"],
    )
    _set_csrf_cookie(response, max_age_seconds=login_response["expires_in"])
    return login_response


def _build_admin_sso_state_token(*, nonce: str, next_path: str) -> str:
    oidc_settings = get_settings()
    return create_access_token(
        {
            "type": "admin_sso_state",
            "nonce": nonce,
            "next_path": next_path,
        },
        expires_in=oidc_settings.admin_oidc_state_ttl_seconds,
    )


def _decode_admin_sso_state_token(state_token: str) -> dict[str, str]:
    credentials_exception = HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Invalid admin SSO state.",
    )
    try:
        payload = decode_token(state_token)
    except Exception as exc:  # pragma: no cover - delegated to tests through caller behavior
        raise credentials_exception from exc

    if payload.get("type") != "admin_sso_state":
        raise credentials_exception

    nonce = payload.get("nonce")
    next_path = payload.get("next_path")
    if not isinstance(nonce, str) or not nonce.strip():
        raise credentials_exception
    if not isinstance(next_path, str) or not next_path.startswith("/"):
        raise credentials_exception
    return {
        "nonce": nonce,
        "next_path": next_path,
    }


def _sanitize_next_path(next_path: str | None) -> str:
    if not next_path or not next_path.startswith("/"):
        return "/patients"
    if next_path.startswith("//"):
        return "/patients"
    return next_path


def _admin_sso_login_redirect(path: str = "/login", **query: str) -> RedirectResponse:
    target = _frontend_url_for(path)
    if query:
        target = f"{target}?{urlencode(query)}"
    return RedirectResponse(url=target, status_code=status.HTTP_303_SEE_OTHER)


def _admin_sso_failure_redirect(*, reason: str) -> RedirectResponse:
    response = _admin_sso_login_redirect("/login", error="admin_sso_failed", reason=reason)
    _clear_admin_sso_state_cookie(response)
    _clear_auth_cookie(response)
    return response


def _get_session_id_from_request(request: Request) -> str | None:
    payload = auth_service.get_request_auth_payload(request)
    session_id = payload.get("session_id")
    return session_id if isinstance(session_id, str) and session_id.strip() else None


def _can_return_dev_reset_token(request: Request) -> bool:
    if not get_settings().password_reset_return_token_in_response:
        return False
    hostname = (request.url.hostname or "").strip().lower()
    return hostname in {"localhost", "127.0.0.1", "::1"}


@router.get("/me", response_model=UserMeResponse)
def get_me(
    request: Request,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    """Get current authenticated user's profile"""
    payload = auth_service.get_request_auth_payload(request)
    mfa_authenticated_at = auth_service._coerce_timestamp(payload.get("mfa_authenticated_at"))
    mfa_verified = bool(payload.get("mfa_verified"))
    return UserMeResponse(
        id=str(current_user.id),
        email=current_user.email,
        first_name=current_user.first_name,
        last_name=current_user.last_name,
        role=current_user.role.value,
        verification_status=current_user.verification_status.value if current_user.verification_status else None,
        mfa_verified=mfa_verified,
        mfa_authenticated_at=mfa_authenticated_at,
        mfa_recent_for_privileged_actions=auth_service.is_recent_mfa_authenticated(mfa_authenticated_at),
        auth_source=str(payload.get("auth_source") or "local"),
        sso_provider=payload.get("sso_provider"),
        passkey_onboarding_dismissed=bool(current_user.passkey_onboarding_dismissed),
        passkey_count=len(current_user.passkeys) if hasattr(current_user, "passkeys") else 0,
    )


@router.get("/access-profile", response_model=AccessProfileResponse)
def get_access_profile(
    request: Request,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    payload = auth_service.get_request_auth_payload(request)
    mfa_authenticated_at = auth_service._coerce_timestamp(payload.get("mfa_authenticated_at"))
    reveal_sensitive_details = bool(payload.get("mfa_verified")) and auth_service.is_recent_mfa_authenticated(
        mfa_authenticated_at
    )
    return AccessProfileResponse(
        **auth_service.build_access_profile(
            db,
            current_user,
            reveal_sensitive_details=reveal_sensitive_details,
        )
    )


@router.post("/login", response_model=TokenResponse)
@limiter.limit("60/minute")  # General limit (e.g. successful logins from same IP)
@limiter.limit("10/minute", key_func=get_strict_failed_login_key)  # Strict IP limit for brute-force protection
def login(
    request: Request,
    response: Response,
    payload: LoginRequest,
    db: Session = Depends(auth_service.get_db),
):
    # Prioritize Cloudflare header
    ip = _client_ip(request)

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

    # Attempt authentication
    authenticated_user = auth_service.authenticate_user(db, payload.email, payload.password)

    # Check if account is locked
    locked_until = security_service.check_account_locked(user)
    if locked_until:
        raise HTTPException(
            status_code=423,
            detail=_build_account_locked_detail(locked_until, user=user),
        )

    if not authenticated_user:
        # Record failed attempt
        security_service.handle_failed_login(db, ip, payload.email, user)

        # Log to audit
        audit_entry = AuditLog(
            user_id=user.id if user else None,
            action="login_failed",
            resource_type="user",
            resource_id=user.id if user else None,
            details={"reason": "invalid_credentials"},
            ip_address=ip,
            is_break_glass=False,
            status="failure",
        )
        db.add(audit_entry)
        db.commit()

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if auth_service.is_admin_sso_enforced_for_user(authenticated_user):
        _write_auth_audit(
            db,
            action="admin_sso_login_denied",
            ip_address=ip,
            status_value="failure",
            user=authenticated_user,
            details={"reason": "admin_sso_required"},
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "admin_sso_required",
                "message": "Admin account must continue with Organization SSO.",
                "sso_login_path": "/api/auth/admin/sso/login",
            },
        )

    return _complete_local_login(
        response,
        db=db,
        user=authenticated_user,
        ip_address=ip,
    )


@router.post("/step-up", response_model=TokenResponse)
@limiter.limit("30/minute")
def step_up_auth(
    request: Request,
    response: Response,
    payload: StepUpAuthRequest,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    auth_payload = auth_service.get_request_auth_payload(request)
    auth_source = str(auth_payload.get("auth_source") or "local")
    sso_provider = auth_payload.get("sso_provider")
    session_id = _get_session_id_from_request(request)
    ip = _client_ip(request)

    if auth_source == "sso":
        _write_auth_audit(
            db,
            action="step_up_failed",
            ip_address=ip,
            status_value="failure",
            user=current_user,
            details={"reason": "step_up_not_supported_for_sso"},
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "step_up_not_supported_for_sso",
                "message": "Step-up verification is not available for Organization SSO sessions.",
            },
        )

    if not verify_password(payload.password, current_user.password_hash):
        _write_auth_audit(
            db,
            action="step_up_failed",
            ip_address=ip,
            status_value="failure",
            user=current_user,
            details={"reason": "invalid_password"},
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "invalid_credentials",
                "message": "Password is incorrect.",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    _write_auth_audit(
        db,
        action="step_up_verified",
        ip_address=ip,
        status_value="success",
        user=current_user,
        details={
            "auth_source": auth_source,
            "mfa_verified": True,
        },
    )
    login_response = auth_service.create_login_response(
        current_user,
        db=db,
        mfa_verified=True,
        mfa_authenticated_at=datetime.now(timezone.utc),
        auth_source=auth_source,
        sso_provider=sso_provider if isinstance(sso_provider, str) else None,
        session_id=session_id,
    )
    db.commit()
    _set_auth_cookie(
        response,
        login_response["access_token"],
        max_age_seconds=login_response["expires_in"],
    )
    _set_csrf_cookie(response, max_age_seconds=login_response["expires_in"])
    return login_response


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("60/minute")
def refresh_token(
    request: Request,
    response: Response,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    """Refresh access token for authenticated user"""
    payload = auth_service.get_request_auth_payload(request)
    mfa_authenticated_at = auth_service._coerce_timestamp(payload.get("mfa_authenticated_at"))
    refreshed = auth_service.create_login_response(
        current_user,
        db=db,
        mfa_verified=bool(payload.get("mfa_verified")),
        mfa_authenticated_at=mfa_authenticated_at,
        auth_source=str(payload.get("auth_source") or "local"),
        sso_provider=payload.get("sso_provider"),
        session_id=str(payload.get("session_id") or ""),
    )
    db.commit()
    _set_auth_cookie(
        response,
        refreshed["access_token"],
        max_age_seconds=refreshed["expires_in"],
    )
    _set_csrf_cookie(
        response,
        max_age_seconds=refreshed["expires_in"],
        token=request.cookies.get(CSRF_COOKIE_NAME),
    )
    return refreshed


@router.post("/logout")
@limiter.limit("60/minute")
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    """Logout endpoint (clears auth cookie)."""
    session_id = _get_session_id_from_request(request)
    admin_sso_store.clear_logout_hint(session_id)
    auth_sessions.revoke_session(db, session_id=session_id)
    _write_auth_audit(
        db,
        action="logout",
        ip_address=_client_ip(request),
        status_value="success",
        user=current_user,
        details={"session_revoked": bool(session_id)},
    )
    db.commit()
    _clear_auth_cookie(response)
    _clear_csrf_cookie(response)
    _clear_admin_sso_state_cookie(response)
    return {"message": "Successfully logged out"}


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
@limiter.limit("10/minute")
@limiter.limit("5/minute", key_func=get_strict_client_ip_rate_limit_key)
def forgot_password(request: Request, payload: ForgotPasswordRequest, db: Session = Depends(auth_service.get_db)):
    """
    Request a password reset token.
    Always returns success to avoid leaking which emails exist.
    """
    user = db.scalar(select(User).where(User.email == payload.email))
    reset_token = None
    if user:
        reset_token = auth_service.create_password_reset_token(user)
        logger.info("Credential recovery flow requested for an existing account")
        _write_auth_audit(
            db,
            action="password_reset_requested",
            ip_address=_client_ip(request),
            status_value="success",
            user=user,
            details={"email": user.email},
        )
    else:
        _write_auth_audit(
            db,
            action="password_reset_requested",
            ip_address=_client_ip(request),
            status_value="failure",
            details={"email": payload.email.lower(), "reason": "account_not_found"},
        )

    db.commit()

    response = ForgotPasswordResponse(
        message="If the account exists, a reset instruction has been generated.",
    )
    # Resolve this flag at request time so tests/env overrides are respected.
    if _can_return_dev_reset_token(request) and reset_token:
        response.reset_token = reset_token

    return response


@router.post("/reset-password", response_model=MessageResponse)
@limiter.limit("10/minute")
@limiter.limit("5/minute", key_func=get_strict_client_ip_rate_limit_key)
def reset_password(request: Request, payload: ResetPasswordRequest, db: Session = Depends(auth_service.get_db)):
    ip = _client_ip(request)
    try:
        token_claims = auth_service.parse_password_reset_token(payload.token)
        user_id = token_claims.user_id
    except HTTPException:
        _write_auth_audit(
            db,
            action="password_reset_denied",
            ip_address=ip,
            status_value="failure",
            details={"reason": "invalid_reset_token"},
        )
        db.commit()
        raise
    try:
        parsed_user_id = UUID(user_id)
    except ValueError:
        _write_auth_audit(
            db,
            action="password_reset_denied",
            ip_address=ip,
            status_value="failure",
            details={"reason": "invalid_reset_token_user_id"},
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid reset token")

    user = db.scalar(
        select(User)
        .where(User.id == parsed_user_id, User.deleted_at.is_(None))
        .with_for_update()
    )
    if not user:
        _write_auth_audit(
            db,
            action="password_reset_denied",
            ip_address=ip,
            status_value="failure",
            details={"reason": "target_not_found", "user_id": str(parsed_user_id)},
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid reset token")

    if auth_service.is_password_reset_token_stale(
        user,
        issued_at=token_claims.issued_at,
        password_changed_marker=token_claims.password_changed_marker,
    ):
        _write_auth_audit(
            db,
            action="password_reset_denied",
            ip_address=ip,
            status_value="failure",
            user=user,
            details={
                "reason": "stale_reset_token",
                "issued_at": token_claims.issued_at.isoformat() if token_claims.issued_at else None,
            },
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid reset token")

    auth_service.reset_user_password(db, user, payload.new_password)
    revoked_sessions = auth_sessions.revoke_user_sessions(db, user_id=user.id)
    _write_auth_audit(
        db,
        action="password_reset_completed",
        ip_address=ip,
        status_value="success",
        user=user,
        details={
            "revoked_sessions": revoked_sessions,
        },
    )
    db.commit()
    return MessageResponse(message="Password reset successful")


@router.get("/invite/{token}", response_model=InviteInfoResponse)
@limiter.limit("60/minute")
def get_invite_info(request: Request, token: str, db: Session = Depends(auth_service.get_db)):
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="Invite token URLs are no longer supported. Use the current invite flow instead.",
    )


@router.post("/invite/inspect", response_model=InviteInfoResponse)
@limiter.limit("60/minute")
def inspect_invite_token(
    request: Request,
    payload: InviteTokenRequest,
    db: Session = Depends(auth_service.get_db),
):
    invite = auth_service.get_active_invite_by_token(db, payload.token)
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite link is invalid or expired")

    return InviteInfoResponse(email=invite.email, role=invite.role, expires_at=invite.expires_at)


@router.post("/invite/accept", response_model=MessageResponse)
@limiter.limit("20/minute")
def accept_invite(request: Request, payload: InviteAcceptRequest, db: Session = Depends(auth_service.get_db)):
    invite = auth_service.get_active_invite_by_token(db, payload.token)
    if not invite:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invite link is invalid or expired")

    if settings.specialist_invite_only and not auth_service.can_receive_user_invite(invite.role):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This onboarding flow currently accepts only supported invite roles.",
        )

    if invite.role in CLINICAL_ROLES and not payload.license_no:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Clinical roles require a license number.",
        )

    existing_user = db.scalar(
        select(User).where(
            User.email == invite.email,
            User.deleted_at.is_(None),
        )
    )
    if existing_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This invite email is already registered")

    legacy_deleted = db.scalar(
        select(User).where(
            User.email == invite.email,
            User.deleted_at.is_not(None),
        )
    )
    if legacy_deleted:
        legacy_deleted.email = _retired_email(legacy_deleted.id)
        db.add(legacy_deleted)
        db.flush()

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
    db.refresh(user)
    db.add(
        AuditLog(
            user_id=user.id,
            action="invite_accept",
            resource_type="user_invite",
            resource_id=invite.id,
            details={"email": invite.email, "role": invite.role.value},
            ip_address=_client_ip(request),
            is_break_glass=False,
            status="success",
        )
    )
    db.commit()
    try:
        anyio.from_thread.run(publish_user_registered, user.id)
    except Exception:
        logger.warning("Failed to publish user registration event", exc_info=True)
    return MessageResponse(message="Account created successfully")
