import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urlencode
from uuid import UUID

import anyio
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response, status
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.limiter import (
    limiter,
    get_strict_client_ip_rate_limit_key,
    get_strict_failed_login_key,
)
from app.core.security import (
    build_totp_uri,
    create_access_token,
    decode_token,
    generate_totp_secret,
    generate_security_token,
    get_password_hash,
    hash_security_token,
    normalize_backup_code,
    normalize_totp_code,
    verify_password,
    verify_totp_code,
)
from app.core.secret_crypto import SecretDecryptionError
from app.models.audit_log import AuditLog
from app.models.enums import UserRole
from app.models.user_trusted_device import UserTrustedDevice
from app.models.user import User
from app.schemas.auth import (
    AccessProfileResponse,
    BackupCodesResponse,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    AdminSSOHealthResponse,
    AdminSSOLogoutResponse,
    Admin2FAResetRequest,
    Admin2FAStatusResponse,
    Admin2FAVerifyRequest,
    TwoFactorDisableRequest,
    TwoFactorBackupCodeUseRequest,
    TwoFactorStatusResponse,
    TwoFactorVerifyRequest,
    TrustedDeviceListResponse,
    TrustedDeviceOut,
    TrustedDevicesRevokeAllResponse,
    InviteAcceptRequest,
    InviteInfoResponse,
    InviteTokenRequest,
    LoginRequest,
    MessageResponse,
    ResetPasswordRequest,
    StepUpAuthRequest,
    TokenResponse,
    AdminSSOStatusResponse,
    UserMeResponse,
)
from app.schemas.user import CLINICAL_ROLES
from app.services import auth as auth_service
from app.services import auth_sessions
from app.services import admin_sso
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


def _set_trusted_device_cookie(response: Response, raw_token: str, max_age_seconds: int) -> None:
    response.set_cookie(
        key=settings.trusted_device_cookie_name,
        value=raw_token,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="lax",
        max_age=max_age_seconds,
        path="/",
    )


def _clear_trusted_device_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.trusted_device_cookie_name,
        path="/",
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="lax",
    )


def _get_trusted_device_cookie(request: Request) -> str | None:
    return request.cookies.get(settings.trusted_device_cookie_name)


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


def _two_factor_required_for_user(user: User) -> bool:
    return (settings.admin_2fa_required and user.role == UserRole.admin) or bool(user.two_factor_enabled)


def _two_factor_setup_required(user: User) -> bool:
    return not bool(user.two_factor_enabled)


def _get_two_factor_secret_or_raise(user: User) -> str | None:
    try:
        return user.two_factor_secret
    except SecretDecryptionError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Two-factor secret is unavailable. Contact support.",
        ) from exc


def _ensure_two_factor_secret(db: Session, user: User) -> None:
    if _get_two_factor_secret_or_raise(user):
        return
    user.two_factor_secret = generate_totp_secret()
    if user.two_factor_enabled:
        user.two_factor_enabled = False
        user.two_factor_enabled_at = None
    db.add(user)
    db.flush()


def _trusted_device_days_for_user(user: User) -> int:
    return security_service.trusted_device_days_for_user(user)


def _build_two_factor_status(user: User) -> TwoFactorStatusResponse:
    required = _two_factor_required_for_user(user)
    setup_required = _two_factor_setup_required(user)
    two_factor_secret = _get_two_factor_secret_or_raise(user)
    provisioning_uri = None
    if setup_required and two_factor_secret:
        provisioning_uri = build_totp_uri(
            two_factor_secret,
            user.email,
            settings.admin_2fa_issuer,
        )
    return TwoFactorStatusResponse(
        role=user.role.value,
        required=required,
        enabled=bool(user.two_factor_enabled),
        setup_required=setup_required,
        issuer=settings.admin_2fa_issuer,
        account_email=user.email,
        provisioning_uri=provisioning_uri,
        trusted_device_days=_trusted_device_days_for_user(user),
    )


def _build_two_factor_challenge_detail(user: User) -> dict[str, str | bool | int]:
    setup_required = _two_factor_setup_required(user)
    two_factor_secret = _get_two_factor_secret_or_raise(user)
    detail: dict[str, str | bool | int] = {
        "code": "two_factor_required",
        "message": "Two-factor verification code is required.",
        "required": True,
        "setup_required": setup_required,
        "issuer": settings.admin_2fa_issuer,
        "trusted_device_days": _trusted_device_days_for_user(user),
    }
    if setup_required and two_factor_secret:
        detail["provisioning_uri"] = build_totp_uri(
            two_factor_secret,
            user.email,
            settings.admin_2fa_issuer,
        )
    return detail


@dataclass
class _SecondFactorOutcome:
    mfa_verified: bool
    mfa_authenticated_at: datetime | None
    used_backup_code: bool = False
    used_trusted_device: bool = False
    trusted_device_raw_token: str | None = None
    trusted_device: UserTrustedDevice | None = None
    challenge_required: bool = False


def _resolve_second_factor_outcome(
    request: Request,
    db: Session,
    user: User,
    *,
    otp_code_input: str | None,
    remember_device: bool,
) -> _SecondFactorOutcome:
    if not _two_factor_required_for_user(user):
        return _SecondFactorOutcome(
            mfa_verified=True,
            mfa_authenticated_at=datetime.now(timezone.utc),
        )

    _ensure_two_factor_secret(db, user)

    trusted_cookie = _get_trusted_device_cookie(request)
    if trusted_cookie:
        trusted = security_service.get_active_trusted_device(
            db,
            user_id=user.id,
            raw_token=trusted_cookie,
            user_agent=request.headers.get("user-agent"),
        )
        if trusted:
            security_service.mark_trusted_device_used(db, trusted)
            return _SecondFactorOutcome(
                mfa_verified=True,
                mfa_authenticated_at=datetime.now(timezone.utc),
                used_trusted_device=True,
            )

    otp_code = normalize_totp_code(otp_code_input)
    backup_code = normalize_backup_code(otp_code_input)
    if not otp_code_input:
        return _SecondFactorOutcome(
            mfa_verified=False,
            mfa_authenticated_at=None,
            challenge_required=True,
        )

    verified = False
    used_backup = False
    two_factor_secret = _get_two_factor_secret_or_raise(user)
    if otp_code and two_factor_secret and verify_totp_code(two_factor_secret, otp_code):
        verified = True
    elif backup_code and user.two_factor_enabled:
        verified = security_service.use_backup_code(
            db,
            user_id=user.id,
            code=backup_code,
        )
        used_backup = verified

    if not verified:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "invalid_two_factor_code",
                "message": "Invalid two-factor authentication code",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    mfa_authenticated_at = datetime.now(timezone.utc)

    if not user.two_factor_enabled:
        user.two_factor_enabled = True
        user.two_factor_enabled_at = mfa_authenticated_at
        db.add(user)

    trusted_device_raw_token: str | None = None
    trusted_device: UserTrustedDevice | None = None
    if remember_device:
        trusted_device_raw_token, trusted_device = security_service.create_trusted_device(
            db,
            user=user,
            ip_address=_client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )

    return _SecondFactorOutcome(
        mfa_verified=True,
        mfa_authenticated_at=mfa_authenticated_at,
        used_backup_code=used_backup,
        trusted_device_raw_token=trusted_device_raw_token,
        trusted_device=trusted_device,
    )


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
    second_factor: "_SecondFactorOutcome",
):
    if second_factor.used_backup_code:
        db.add(
            AuditLog(
                user_id=user.id,
                action="login_with_backup_code",
                resource_type="user",
                resource_id=user.id,
                details={"event": "backup_code_login"},
                ip_address=ip_address,
                is_break_glass=False,
                status="success",
            )
        )

    if second_factor.trusted_device is not None:
        db.add(
            AuditLog(
                user_id=user.id,
                action="trusted_device_created",
                resource_type="user_trusted_device",
                resource_id=second_factor.trusted_device.id,
                details={"trusted_device_id": str(second_factor.trusted_device.id)},
                ip_address=ip_address,
                is_break_glass=False,
                status="success",
            )
        )

    security_service.handle_successful_login(db, ip_address, user)

    _write_auth_audit(
        db,
        action="login_success",
        ip_address=ip_address,
        status_value="success",
        user=user,
        details={
            "auth_source": "local",
            "mfa_verified": second_factor.mfa_verified,
            "used_backup_code": second_factor.used_backup_code,
            "used_trusted_device": second_factor.used_trusted_device,
        },
    )
    login_response = auth_service.create_login_response(
        user,
        db=db,
        mfa_verified=second_factor.mfa_verified,
        mfa_authenticated_at=second_factor.mfa_authenticated_at,
    )
    db.commit()
    _set_auth_cookie(
        response,
        login_response["access_token"],
        max_age_seconds=login_response["expires_in"],
    )
    _set_csrf_cookie(response, max_age_seconds=login_response["expires_in"])
    if second_factor.trusted_device_raw_token:
        _set_trusted_device_cookie(
            response,
            second_factor.trusted_device_raw_token,
            max_age_seconds=_trusted_device_days_for_user(user) * 24 * 60 * 60,
        )
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


def _revoke_user_two_factor_artifacts(db: Session, user: User) -> tuple[int, int]:
    revoked_devices = security_service.revoke_all_trusted_devices(db, user_id=user.id)
    revoked_codes = security_service.revoke_backup_codes(db, user_id=user.id)
    return revoked_devices, revoked_codes


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
        two_factor_enabled=current_user.two_factor_enabled,
        mfa_verified=mfa_verified,
        mfa_authenticated_at=mfa_authenticated_at,
        mfa_recent_for_privileged_actions=auth_service.is_recent_mfa_authenticated(mfa_authenticated_at),
        auth_source=str(payload.get("auth_source") or "local"),
        sso_provider=payload.get("sso_provider"),
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


@router.get("/2fa/status", response_model=TwoFactorStatusResponse)
@limiter.limit("60/minute")
def get_two_factor_status(
    request: Request,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    auth_service.require_recent_sensitive_session(request)
    _ensure_two_factor_secret(db, current_user)
    db.commit()
    db.refresh(current_user)
    return _build_two_factor_status(current_user)


@router.post("/2fa/verify", response_model=MessageResponse)
@limiter.limit("10/minute")
def verify_two_factor(
    request: Request,
    payload: TwoFactorVerifyRequest,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    auth_service.require_recent_sensitive_session(request)
    _ensure_two_factor_secret(db, current_user)

    otp_code = normalize_totp_code(payload.otp_code)
    two_factor_secret = _get_two_factor_secret_or_raise(current_user)
    if not otp_code or not two_factor_secret or not verify_totp_code(two_factor_secret, otp_code):
        _write_auth_audit(
            db,
            action="two_factor_verify_failed",
            ip_address=_client_ip(request),
            status_value="failure",
            user=current_user,
            details={"reason": "invalid_two_factor_code"},
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid two-factor authentication code.")

    current_user.two_factor_enabled = True
    current_user.two_factor_enabled_at = datetime.now(timezone.utc)
    db.add(current_user)
    _write_auth_audit(
        db,
        action="two_factor_verified",
        ip_address=_client_ip(request),
        status_value="success",
        user=current_user,
        details={"event": "two_factor_verified"},
    )
    db.commit()
    return MessageResponse(message="Two-factor authentication verified successfully.")


@router.post("/2fa/disable", response_model=MessageResponse)
@limiter.limit("10/minute")
def disable_two_factor(
    request: Request,
    payload: TwoFactorDisableRequest,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    if current_user.role == UserRole.admin and settings.admin_2fa_required:
        _write_auth_audit(
            db,
            action="two_factor_disable_denied",
            ip_address=_client_ip(request),
            status_value="failure",
            user=current_user,
            details={"reason": "policy_required"},
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Admin 2FA cannot be disabled by policy.")
    two_factor_secret = _get_two_factor_secret_or_raise(current_user)
    if not current_user.two_factor_enabled or not two_factor_secret:
        return MessageResponse(message="Two-factor authentication is already disabled.")

    otp_code = normalize_totp_code(payload.current_otp_code)
    if not otp_code or not verify_totp_code(two_factor_secret, otp_code):
        _write_auth_audit(
            db,
            action="two_factor_disable_denied",
            ip_address=_client_ip(request),
            status_value="failure",
            user=current_user,
            details={"reason": "invalid_current_two_factor_code"},
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current 2FA code is invalid.")

    current_user.two_factor_enabled = False
    current_user.two_factor_enabled_at = None
    current_user.two_factor_secret = None
    revoked_devices, revoked_codes = _revoke_user_two_factor_artifacts(db, current_user)
    db.add(current_user)
    _write_auth_audit(
        db,
        action="two_factor_disabled",
        ip_address=_client_ip(request),
        status_value="success",
        user=current_user,
        details={"revoked_devices": revoked_devices, "revoked_backup_codes": revoked_codes},
    )
    db.commit()
    return MessageResponse(message="Two-factor authentication disabled.")


@router.post("/2fa/reset", response_model=TwoFactorStatusResponse)
@limiter.limit("10/minute")
def reset_two_factor(
    request: Request,
    payload: Admin2FAResetRequest,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    two_factor_secret = _get_two_factor_secret_or_raise(current_user)
    if current_user.two_factor_enabled and two_factor_secret:
        current_code = normalize_totp_code(payload.current_otp_code)
        if not current_code or not verify_totp_code(two_factor_secret, current_code):
            _write_auth_audit(
                db,
                action="two_factor_reset_denied",
                ip_address=_client_ip(request),
                status_value="failure",
                user=current_user,
                details={"reason": "invalid_current_two_factor_code"},
            )
            db.commit()
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current 2FA code is required to reset.")

    current_user.two_factor_secret = generate_totp_secret()
    current_user.two_factor_enabled = False
    current_user.two_factor_enabled_at = None
    revoked_devices, revoked_codes = _revoke_user_two_factor_artifacts(db, current_user)
    db.add(current_user)
    _write_auth_audit(
        db,
        action="two_factor_reset",
        ip_address=_client_ip(request),
        status_value="success",
        user=current_user,
        details={
            "reason": payload.reason or "",
            "revoked_devices": revoked_devices,
            "revoked_backup_codes": revoked_codes,
        },
    )
    db.commit()
    db.refresh(current_user)
    return _build_two_factor_status(current_user)


@router.post("/2fa/backup-codes/regenerate", response_model=BackupCodesResponse)
@limiter.limit("5/minute")
def regenerate_backup_codes(
    request: Request,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    auth_service.require_recent_sensitive_session(request)
    if not current_user.two_factor_enabled:
        _write_auth_audit(
            db,
            action="two_factor_backup_codes_regenerate_denied",
            ip_address=_client_ip(request),
            status_value="failure",
            user=current_user,
            details={"reason": "two_factor_not_enabled"},
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Enable 2FA before generating backup codes.")

    codes, expires_at = security_service.generate_backup_codes(db, user_id=current_user.id)
    generated_at = datetime.now(timezone.utc)
    _write_auth_audit(
        db,
        action="two_factor_backup_codes_regenerated",
        ip_address=_client_ip(request),
        status_value="success",
        user=current_user,
        details={"count": len(codes)},
    )
    db.commit()
    return BackupCodesResponse(codes=codes, generated_at=generated_at, expires_at=expires_at)


@router.post("/2fa/backup-codes/use", response_model=MessageResponse)
@limiter.limit("10/minute")
def use_backup_code(
    request: Request,
    payload: TwoFactorBackupCodeUseRequest,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    if not current_user.two_factor_enabled:
        _write_auth_audit(
            db,
            action="two_factor_backup_code_use_denied",
            ip_address=_client_ip(request),
            status_value="failure",
            user=current_user,
            details={"reason": "two_factor_not_enabled"},
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Two-factor authentication is not enabled.")

    if not security_service.use_backup_code(db, user_id=current_user.id, code=payload.code):
        _write_auth_audit(
            db,
            action="two_factor_backup_code_use_denied",
            ip_address=_client_ip(request),
            status_value="failure",
            user=current_user,
            details={"reason": "invalid_or_used_backup_code"},
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or already used backup code.")

    _write_auth_audit(
        db,
        action="two_factor_backup_code_used",
        ip_address=_client_ip(request),
        status_value="success",
        user=current_user,
        details="Backup code used from authenticated session",
    )
    db.commit()
    return MessageResponse(message="Backup code accepted.")


@router.get("/2fa/trusted-devices", response_model=TrustedDeviceListResponse)
@limiter.limit("30/minute")
def list_trusted_devices(
    request: Request,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    now = datetime.now(timezone.utc)
    raw_cookie = _get_trusted_device_cookie(request)
    current_hash = hash_security_token(raw_cookie) if raw_cookie else None

    devices = db.scalars(
        select(UserTrustedDevice).where(
            UserTrustedDevice.user_id == current_user.id,
            UserTrustedDevice.revoked_at.is_(None),
            UserTrustedDevice.expires_at > now,
        ).order_by(UserTrustedDevice.created_at.desc())
    ).all()

    items = [
        TrustedDeviceOut(
            id=str(device.id),
            ip_address=device.ip_address,
            created_at=device.created_at,
            last_used_at=device.last_used_at,
            expires_at=device.expires_at,
            current_device=bool(current_hash and device.token_hash == current_hash),
        )
        for device in devices
    ]
    return TrustedDeviceListResponse(items=items, total=len(items))


@router.delete("/2fa/trusted-devices/{device_id}", response_model=MessageResponse)
@limiter.limit("30/minute")
def revoke_trusted_device(
    request: Request,
    response: Response,
    device_id: UUID = Path(...),
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    revoked = security_service.revoke_trusted_device(db, user_id=current_user.id, device_id=device_id)
    if not revoked:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trusted device not found.")

    raw_cookie = _get_trusted_device_cookie(request)
    current_hash = hash_security_token(raw_cookie) if raw_cookie else None
    revoked_row = db.scalar(select(UserTrustedDevice).where(UserTrustedDevice.id == device_id))

    db.add(
        AuditLog(
            user_id=current_user.id,
            action="trusted_device_revoked",
            resource_type="user_trusted_device",
            resource_id=device_id,
            details={"device_id": str(device_id)},
            ip_address=_client_ip(request),
            is_break_glass=False,
            status="success",
        )
    )
    db.commit()
    if revoked_row and current_hash and revoked_row.token_hash == current_hash:
        _clear_trusted_device_cookie(response)
    return MessageResponse(message="Trusted device revoked.")


@router.post("/2fa/trusted-devices/revoke-all", response_model=TrustedDevicesRevokeAllResponse)
@limiter.limit("20/minute")
def revoke_all_trusted_devices(
    request: Request,
    response: Response,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    revoked = security_service.revoke_all_trusted_devices(db, user_id=current_user.id)
    db.add(
        AuditLog(
            user_id=current_user.id,
            action="trusted_devices_revoked_all",
            resource_type="user",
            resource_id=current_user.id,
            details={"revoked": revoked},
            ip_address=_client_ip(request),
            is_break_glass=False,
            status="success",
        )
    )
    db.commit()
    _clear_trusted_device_cookie(response)
    return TrustedDevicesRevokeAllResponse(revoked=revoked)


# Legacy admin-only endpoints retained for backward compatibility.
@router.get("/2fa/admin", response_model=Admin2FAStatusResponse)
@limiter.limit("60/minute")
def get_admin_2fa_status(
    request: Request,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    if current_user.role != UserRole.admin:
        return Admin2FAStatusResponse(required=False, enabled=False, setup_required=False)
    if _two_factor_required_for_user(current_user):
        _ensure_two_factor_secret(db, current_user)
        db.commit()
        db.refresh(current_user)
    status_data = _build_two_factor_status(current_user)
    return Admin2FAStatusResponse(
        required=status_data.required,
        enabled=status_data.enabled,
        setup_required=status_data.setup_required,
        issuer=status_data.issuer,
        account_email=status_data.account_email,
        provisioning_uri=status_data.provisioning_uri,
        trusted_device_days=status_data.trusted_device_days,
    )


@router.post("/2fa/admin/verify", response_model=MessageResponse)
@limiter.limit("10/minute")
def verify_admin_2fa(
    request: Request,
    payload: Admin2FAVerifyRequest,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    return verify_two_factor(
        request=request,
        payload=TwoFactorVerifyRequest(otp_code=payload.otp_code),
        db=db,
        current_user=current_user,
    )


@router.post("/2fa/admin/reset", response_model=Admin2FAStatusResponse)
@limiter.limit("10/minute")
def reset_admin_2fa(
    request: Request,
    payload: Admin2FAResetRequest,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    status_data = reset_two_factor(
        request=request,
        payload=payload,
        db=db,
        current_user=current_user,
    )
    return Admin2FAStatusResponse(
        required=status_data.required,
        enabled=status_data.enabled,
        setup_required=status_data.setup_required,
        issuer=status_data.issuer,
        account_email=status_data.account_email,
        provisioning_uri=status_data.provisioning_uri,
        trusted_device_days=status_data.trusted_device_days,
    )


@router.get("/admin/sso/status", response_model=AdminSSOStatusResponse)
def get_admin_sso_status():
    return AdminSSOStatusResponse(**admin_sso.get_status_payload())


@router.get("/admin/sso/health", response_model=AdminSSOHealthResponse)
def get_admin_sso_health():
    settings = get_settings()
    issuer = (settings.admin_oidc_issuer_url or "").strip() or None
    metadata_endpoint = _admin_sso_metadata_endpoint(issuer)
    if not admin_sso.is_enabled():
        return AdminSSOHealthResponse(
            status="disabled",
            provider=None,
            issuer=None,
            metadata_endpoint=None,
        )

    try:
        admin_sso._fetch_metadata()
    except admin_sso.AdminSsoConfigurationError as exc:
        _log_admin_sso_event(
            "Admin SSO health check misconfigured",
            level=logging.WARNING,
            event="admin_sso_health_check",
            reason="misconfigured",
            provider=settings.admin_oidc_provider_name,
            metadata_endpoint=metadata_endpoint,
            details=str(exc),
        )
        return AdminSSOHealthResponse(
            status="misconfigured",
            provider=settings.admin_oidc_provider_name,
            issuer=issuer,
            details=str(exc),
            metadata_endpoint=metadata_endpoint,
        )
    except Exception:
        _log_admin_sso_event(
            "Admin SSO health check could not reach metadata endpoint",
            level=logging.WARNING,
            event="admin_sso_health_check",
            reason="unreachable",
            provider=settings.admin_oidc_provider_name,
            metadata_endpoint=metadata_endpoint,
            details="OIDC metadata endpoint is unreachable.",
            exc_info=True,
        )
        return AdminSSOHealthResponse(
            status="unreachable",
            provider=settings.admin_oidc_provider_name,
            issuer=issuer,
            details="OIDC metadata endpoint is unreachable.",
            metadata_endpoint=metadata_endpoint,
        )

    _log_admin_sso_event(
        "Admin SSO health check healthy",
        event="admin_sso_health_check",
        reason="healthy",
        provider=settings.admin_oidc_provider_name,
        metadata_endpoint=metadata_endpoint,
    )
    return AdminSSOHealthResponse(
        status="healthy",
        provider=settings.admin_oidc_provider_name,
        issuer=issuer,
        metadata_endpoint=metadata_endpoint,
    )


@router.get("/admin/sso/login")
def start_admin_sso_login(
    next_path: str | None = Query(default="/patients", alias="next"),
):
    if not admin_sso.is_enabled():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Admin SSO is disabled.")

    nonce = generate_security_token(16)
    code_verifier = admin_sso.generate_pkce_code_verifier()
    code_challenge = admin_sso.create_pkce_code_challenge(code_verifier)
    sanitized_next_path = _sanitize_next_path(next_path)
    state_token = _build_admin_sso_state_token(
        nonce=nonce,
        next_path=sanitized_next_path,
    )
    admin_sso_store.store_login_artifact(
        state_token=state_token,
        nonce=nonce,
        code_verifier=code_verifier,
        next_path=sanitized_next_path,
    )
    try:
        authorize_url = admin_sso.build_authorize_url(
            state_token=state_token,
            nonce=nonce,
            code_challenge=code_challenge,
        )
    except admin_sso.AdminSsoConfigurationError as exc:
        admin_sso_store.clear_login_artifact(state_token)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    response = RedirectResponse(url=authorize_url, status_code=status.HTTP_303_SEE_OTHER)
    _set_admin_sso_state_cookie(response, state_token)
    return response


@router.get("/admin/sso/callback")
@limiter.limit("10/minute", key_func=get_strict_client_ip_rate_limit_key)
def complete_admin_sso_login(
    request: Request,
    db: Session = Depends(auth_service.get_db),
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    error_description: str | None = Query(default=None),
):
    state_cookie = _get_admin_sso_state_cookie(request)
    if error:
        _write_auth_audit(
            db,
            action="admin_sso_login_denied",
            ip_address=_client_ip(request),
            status_value="failure",
            details={
                "reason": "provider_error",
                "provider_error": error,
                "provider_error_description": error_description or "",
            },
        )
        _log_admin_sso_event(
            "Admin SSO login denied: reason=provider_error",
            level=logging.WARNING,
            event="admin_sso_login_denied",
            reason="provider_error",
            provider=get_settings().admin_oidc_provider_name,
            provider_error=error,
        )
        db.commit()
        return _admin_sso_failure_redirect(reason="provider_error")

    if not code or not state:
        _write_auth_audit(
            db,
            action="admin_sso_login_denied",
            ip_address=_client_ip(request),
            status_value="failure",
            details={"reason": "invalid_state"},
        )
        _log_admin_sso_event(
            "Admin SSO login denied: reason=invalid_state_missing_code_or_state",
            level=logging.WARNING,
            event="admin_sso_login_denied",
            reason="invalid_state",
            provider=get_settings().admin_oidc_provider_name,
            missing_field="code_or_state",
        )
        db.commit()
        return _admin_sso_failure_redirect(reason="invalid_state")

    if not state_cookie:
        admin_sso_store.clear_login_artifact(state)
        _write_auth_audit(
            db,
            action="admin_sso_login_denied",
            ip_address=_client_ip(request),
            status_value="failure",
            details={"reason": "missing_state_cookie"},
        )
        _log_admin_sso_event(
            "Admin SSO login denied: reason=missing_state_cookie",
            level=logging.WARNING,
            event="admin_sso_login_denied",
            reason="missing_state_cookie",
            provider=get_settings().admin_oidc_provider_name,
        )
        db.commit()
        return _admin_sso_failure_redirect(reason="missing_state_cookie")

    if state != state_cookie:
        admin_sso_store.clear_login_artifact(state)
        _write_auth_audit(
            db,
            action="admin_sso_login_denied",
            ip_address=_client_ip(request),
            status_value="failure",
            details={"reason": "invalid_state"},
        )
        _log_admin_sso_event(
            "Admin SSO login denied: reason=invalid_state_mismatch",
            level=logging.WARNING,
            event="admin_sso_login_denied",
            reason="invalid_state",
            provider=get_settings().admin_oidc_provider_name,
        )
        db.commit()
        return _admin_sso_failure_redirect(reason="invalid_state")

    try:
        state_payload = _decode_admin_sso_state_token(state)
    except HTTPException:
        admin_sso_store.clear_login_artifact(state)
        _write_auth_audit(
            db,
            action="admin_sso_login_denied",
            ip_address=_client_ip(request),
            status_value="failure",
            details={"reason": "invalid_state_token"},
        )
        _log_admin_sso_event(
            "Admin SSO login denied: reason=invalid_state_token",
            level=logging.WARNING,
            event="admin_sso_login_denied",
            reason="invalid_state_token",
            provider=get_settings().admin_oidc_provider_name,
        )
        db.commit()
        return _admin_sso_failure_redirect(reason="invalid_state")

    login_artifact = admin_sso_store.pop_login_artifact(state)
    if login_artifact is None:
        _write_auth_audit(
            db,
            action="admin_sso_login_denied",
            ip_address=_client_ip(request),
            status_value="failure",
            details={"reason": "expired_sso_session"},
        )
        _log_admin_sso_event(
            "Admin SSO login denied: reason=expired_sso_session",
            level=logging.WARNING,
            event="admin_sso_login_denied",
            reason="expired_sso_session",
            provider=get_settings().admin_oidc_provider_name,
        )
        db.commit()
        return _admin_sso_failure_redirect(reason="expired_sso_session")

    if login_artifact.nonce != state_payload["nonce"] or login_artifact.next_path != state_payload["next_path"]:
        _write_auth_audit(
            db,
            action="admin_sso_login_denied",
            ip_address=_client_ip(request),
            status_value="failure",
            details={"reason": "invalid_state"},
        )
        _log_admin_sso_event(
            "Admin SSO login denied: reason=invalid_state_artifact_mismatch",
            level=logging.WARNING,
            event="admin_sso_login_denied",
            reason="invalid_state",
            provider=get_settings().admin_oidc_provider_name,
        )
        db.commit()
        return _admin_sso_failure_redirect(reason="invalid_state")

    try:
        identity = admin_sso.complete_callback(
            code=code,
            expected_nonce=state_payload["nonce"],
            code_verifier=login_artifact.code_verifier,
        )
    except (admin_sso.AdminSsoConfigurationError, admin_sso.AdminSsoExchangeError) as exc:
        _write_auth_audit(
            db,
            action="admin_sso_login_denied",
            ip_address=_client_ip(request),
            status_value="failure",
            details={"reason": "token_exchange_failed", "message": str(exc)},
        )
        _log_admin_sso_event(
            "Admin SSO login denied: reason=token_exchange_failed",
            level=logging.WARNING,
            event="admin_sso_login_denied",
            reason="token_exchange_failed",
            provider=get_settings().admin_oidc_provider_name,
        )
        db.commit()
        return _admin_sso_failure_redirect(reason="provider_exchange")

    if not identity.email_verified:
        _write_auth_audit(
            db,
            action="admin_sso_claim_mismatch",
            ip_address=_client_ip(request),
            status_value="failure",
            details={"reason": "email_not_verified", "email": identity.email},
        )
        _log_admin_sso_event(
            "Admin SSO claim mismatch: reason=email_not_verified",
            level=logging.WARNING,
            event="admin_sso_login_denied",
            reason="email_not_verified",
            provider=identity.provider,
            email=identity.email,
        )
        db.commit()
        return _admin_sso_failure_redirect(reason="email_not_verified")

    if not admin_sso.email_domain_allowed(identity.email):
        _write_auth_audit(
            db,
            action="admin_sso_claim_mismatch",
            ip_address=_client_ip(request),
            status_value="failure",
            details={"reason": "email_domain_not_allowed", "email": identity.email},
        )
        _log_admin_sso_event(
            "Admin SSO claim mismatch: reason=email_domain_not_allowed",
            level=logging.WARNING,
            event="admin_sso_login_denied",
            reason="email_domain_not_allowed",
            provider=identity.provider,
            email=identity.email,
        )
        db.commit()
        return _admin_sso_failure_redirect(reason="email_domain_not_allowed")

    if not admin_sso.required_group_present(identity.groups):
        _write_auth_audit(
            db,
            action="admin_sso_group_denied",
            ip_address=_client_ip(request),
            status_value="failure",
            details={"reason": "required_group_missing", "email": identity.email, "groups": list(identity.groups)},
        )
        _log_admin_sso_event(
            "Admin SSO group denied: reason=required_group_missing",
            level=logging.WARNING,
            event="admin_sso_login_denied",
            reason="required_group_missing",
            provider=identity.provider,
            email=identity.email,
        )
        db.commit()
        return _admin_sso_failure_redirect(reason="required_group_missing")

    user = db.scalar(select(User).where(User.email == identity.email, User.deleted_at.is_(None)))
    if user is None:
        _write_auth_audit(
            db,
            action="admin_sso_login_denied",
            ip_address=_client_ip(request),
            status_value="failure",
            details={"reason": "admin_account_not_found", "email": identity.email},
        )
        _log_admin_sso_event(
            "Admin SSO login denied: reason=admin_account_not_found",
            level=logging.WARNING,
            event="admin_sso_login_denied",
            reason="admin_account_not_found",
            provider=identity.provider,
            email=identity.email,
        )
        db.commit()
        return _admin_sso_failure_redirect(reason="admin_account_not_found")

    if user.role != UserRole.admin:
        _write_auth_audit(
            db,
            action="admin_sso_login_denied",
            ip_address=_client_ip(request),
            status_value="failure",
            user=user,
            details={"reason": "admin_role_required", "email": identity.email},
        )
        _log_admin_sso_event(
            "Admin SSO login denied: reason=admin_role_required",
            level=logging.WARNING,
            event="admin_sso_login_denied",
            reason="admin_role_required",
            provider=identity.provider,
            email=identity.email,
        )
        db.commit()
        return _admin_sso_failure_redirect(reason="admin_role_required")

    if not user.is_active:
        _write_auth_audit(
            db,
            action="admin_sso_login_denied",
            ip_address=_client_ip(request),
            status_value="failure",
            user=user,
            details={"reason": "account_deactivated", "email": identity.email},
        )
        _log_admin_sso_event(
            "Admin SSO login denied: reason=account_deactivated",
            level=logging.WARNING,
            event="admin_sso_login_denied",
            reason="account_deactivated",
            provider=identity.provider,
            email=identity.email,
        )
        db.commit()
        return _admin_sso_failure_redirect(reason="account_deactivated")

    if auth_service.requires_token_mfa(user) and not identity.mfa_verified:
        _write_auth_audit(
            db,
            action="admin_sso_claim_mismatch",
            ip_address=_client_ip(request),
            status_value="failure",
            user=user,
            details={"reason": "mfa_claim_required", "email": identity.email, "amr": list(identity.amr)},
        )
        _log_admin_sso_event(
            "Admin SSO claim mismatch: reason=mfa_claim_required",
            level=logging.WARNING,
            event="admin_sso_login_denied",
            reason="mfa_claim_required",
            provider=identity.provider,
            email=identity.email,
            mfa_verified=identity.mfa_verified,
        )
        db.commit()
        return _admin_sso_failure_redirect(reason="mfa_required")

    login_response = auth_service.create_login_response(
        user,
        db=db,
        mfa_verified=identity.mfa_verified,
        mfa_authenticated_at=identity.auth_time,
        auth_source="sso",
        sso_provider=identity.provider,
    )
    success_response = RedirectResponse(
        url=_frontend_url_for(login_artifact.next_path),
        status_code=status.HTTP_303_SEE_OTHER,
    )
    _set_auth_cookie(
        success_response,
        login_response["access_token"],
        max_age_seconds=login_response["expires_in"],
    )
    _set_csrf_cookie(success_response, max_age_seconds=login_response["expires_in"])
    _clear_admin_sso_state_cookie(success_response)
    session_id = login_response.get("session_id")
    if identity.id_token and isinstance(session_id, str) and session_id:
        admin_sso_store.store_logout_hint(
            session_id=session_id,
            id_token_hint=identity.id_token,
            ttl_seconds=login_response["expires_in"],
        )

    _write_auth_audit(
        db,
        action="admin_sso_login_success",
        ip_address=_client_ip(request),
        status_value="success",
        user=user,
        details={
            "provider": identity.provider,
            "auth_source": "sso",
            "mfa_verified": identity.mfa_verified,
            "amr": list(identity.amr),
        },
    )
    _log_admin_sso_event(
        "Admin SSO login success",
        event="admin_sso_login_success",
        reason="success",
        provider=identity.provider,
        email=identity.email,
        mfa_verified=identity.mfa_verified,
    )
    db.commit()
    return success_response


@router.get("/admin/sso/logout")
def logout_admin_sso_compat(
    request: Request,
    db: Session = Depends(auth_service.get_db),
    current_user: User | None = Depends(auth_service.get_optional_current_user),
):
    response = _admin_sso_login_redirect(
        "/login",
        error="admin_sso_failed",
        reason="deprecated_logout_method",
    )

    _write_auth_audit(
        db,
        action="admin_sso_logout_deprecated_get",
        ip_address=_client_ip(request),
        status_value="failure",
        user=current_user,
        details={"provider": get_settings().admin_oidc_provider_name, "reason": "deprecated_logout_method"},
    )
    _log_admin_sso_event(
        "Deprecated Admin SSO logout GET endpoint invoked",
        level=logging.WARNING,
        event="admin_sso_logout_deprecated_get",
        reason="deprecated_logout_method",
        provider=get_settings().admin_oidc_provider_name,
        email=current_user.email if current_user else None,
    )
    db.commit()
    return response


@router.post("/admin/sso/logout", response_model=AdminSSOLogoutResponse)
@limiter.limit("30/minute")
def logout_admin_sso(
    request: Request,
    response: Response,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    session_id = _get_session_id_from_request(request)
    logout_hint = admin_sso_store.pop_logout_hint(session_id)
    auth_sessions.revoke_session(db, session_id=session_id)
    try:
        redirect_url = admin_sso.build_logout_redirect_url(id_token_hint=logout_hint) or _frontend_url_for("/login")
    except admin_sso.AdminSsoConfigurationError:
        redirect_url = _frontend_url_for("/login")

    _clear_auth_cookie(response)
    _clear_csrf_cookie(response)
    _clear_admin_sso_state_cookie(response)
    _clear_trusted_device_cookie(response)

    _write_auth_audit(
        db,
        action="admin_sso_logout",
        ip_address=_client_ip(request),
        status_value="success",
        user=current_user,
        details={"provider": get_settings().admin_oidc_provider_name},
    )
    _log_admin_sso_event(
        "Admin SSO logout",
        event="admin_sso_logout",
        reason="success",
        provider=get_settings().admin_oidc_provider_name,
        email=current_user.email,
    )
    db.commit()
    return AdminSSOLogoutResponse(redirect_url=redirect_url)


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

    try:
        second_factor = _resolve_second_factor_outcome(
            request,
            db,
            authenticated_user,
            otp_code_input=payload.otp_code,
            remember_device=payload.remember_device,
        )
    except HTTPException:
        security_service.handle_failed_login(
            db,
            ip,
            payload.email,
            authenticated_user,
            details="Invalid two-factor code",
        )
        db.add(
            AuditLog(
                user_id=authenticated_user.id,
                action="login_failed_2fa",
                resource_type="user",
                resource_id=authenticated_user.id,
                details={"reason": "invalid_two_factor_code"},
                ip_address=ip,
                is_break_glass=False,
                status="failure",
            )
        )
        db.commit()
        raise

    if second_factor.challenge_required:
        challenge_detail = _build_two_factor_challenge_detail(authenticated_user)
        db.add(
            AuditLog(
                user_id=authenticated_user.id,
                action="two_factor_challenge",
                resource_type="user",
                resource_id=authenticated_user.id,
                details={"event": "two_factor_challenge"},
                ip_address=ip,
                is_break_glass=False,
                status="success",
            )
        )
        db.commit()
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": challenge_detail},
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _complete_local_login(
        response,
        db=db,
        user=authenticated_user,
        ip_address=ip,
        second_factor=second_factor,
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

    try:
        second_factor = _resolve_second_factor_outcome(
            request,
            db,
            current_user,
            otp_code_input=payload.otp_code,
            remember_device=payload.remember_device,
        )
    except HTTPException:
        _write_auth_audit(
            db,
            action="step_up_failed",
            ip_address=ip,
            status_value="failure",
            user=current_user,
            details={"reason": "invalid_two_factor_code"},
        )
        db.commit()
        raise

    if second_factor.challenge_required:
        challenge_detail = _build_two_factor_challenge_detail(current_user)
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": challenge_detail},
            headers={"WWW-Authenticate": "Bearer"},
        )

    if second_factor.trusted_device is not None:
        db.add(
            AuditLog(
                user_id=current_user.id,
                action="trusted_device_created",
                resource_type="user_trusted_device",
                resource_id=second_factor.trusted_device.id,
                details={"trusted_device_id": str(second_factor.trusted_device.id)},
                ip_address=ip,
                is_break_glass=False,
                status="success",
            )
        )

    _write_auth_audit(
        db,
        action="step_up_verified",
        ip_address=ip,
        status_value="success",
        user=current_user,
        details={
            "auth_source": auth_source,
            "mfa_verified": second_factor.mfa_verified,
            "used_backup_code": second_factor.used_backup_code,
            "used_trusted_device": second_factor.used_trusted_device,
        },
    )
    login_response = auth_service.create_login_response(
        current_user,
        db=db,
        mfa_verified=second_factor.mfa_verified,
        mfa_authenticated_at=second_factor.mfa_authenticated_at,
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
    if second_factor.trusted_device_raw_token:
        _set_trusted_device_cookie(
            response,
            second_factor.trusted_device_raw_token,
            max_age_seconds=_trusted_device_days_for_user(current_user) * 24 * 60 * 60,
        )
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
    _clear_trusted_device_cookie(response)
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
    revoked_devices, revoked_codes = _revoke_user_two_factor_artifacts(db, user)
    _write_auth_audit(
        db,
        action="password_reset_completed",
        ip_address=ip,
        status_value="success",
        user=user,
        details={
            "revoked_sessions": revoked_sessions,
            "revoked_devices": revoked_devices,
            "revoked_backup_codes": revoked_codes,
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
