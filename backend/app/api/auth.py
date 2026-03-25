import logging
from datetime import datetime, timezone
from uuid import UUID

import anyio
from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.limiter import limiter, get_client_ip_rate_limit_key, get_failed_login_key
from app.core.security import (
    build_totp_uri,
    generate_totp_secret,
    get_password_hash,
    hash_security_token,
    normalize_totp_code,
    normalize_backup_code,
    verify_totp_code,
)
from app.models.audit_log import AuditLog
from app.models.enums import UserRole
from app.models.user_trusted_device import UserTrustedDevice
from app.models.user import User
from app.schemas.auth import (
    BackupCodesResponse,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
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
    TokenResponse,
    UserMeResponse,
)
from app.schemas.user import CLINICAL_ROLES
from app.services import auth as auth_service
from app.services import security as security_service
from app.services.user_events import publish_user_registered

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)
settings = get_settings()


def _retired_email(user_id: UUID) -> str:
    """Generate a unique placeholder email for soft-deleted users."""
    return f"deleted+{user_id.hex}@archive.example.com"


def _set_auth_cookie(response: Response, access_token: str) -> None:
    response.set_cookie(
        key=settings.auth_cookie_name,
        value=access_token,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite=settings.auth_cookie_samesite,
        max_age=settings.jwt_expires_in,
        path="/",
    )


def _clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.auth_cookie_name,
        path="/",
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite=settings.auth_cookie_samesite,
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


def _two_factor_required_for_user(user: User) -> bool:
    return (settings.admin_2fa_required and user.role == UserRole.admin) or bool(user.two_factor_enabled)


def _two_factor_setup_required(user: User) -> bool:
    return not bool(user.two_factor_enabled)


def _ensure_two_factor_secret(db: Session, user: User) -> None:
    if user.two_factor_secret:
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
    provisioning_uri = None
    if setup_required and user.two_factor_secret:
        provisioning_uri = build_totp_uri(
            user.two_factor_secret,
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
    detail: dict[str, str | bool | int] = {
        "code": "two_factor_required",
        "message": "Two-factor verification code is required.",
        "required": True,
        "setup_required": setup_required,
        "issuer": settings.admin_2fa_issuer,
        "trusted_device_days": _trusted_device_days_for_user(user),
    }
    if setup_required and user.two_factor_secret:
        detail["provisioning_uri"] = build_totp_uri(
            user.two_factor_secret,
            user.email,
            settings.admin_2fa_issuer,
        )
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


def _revoke_user_two_factor_artifacts(db: Session, user: User) -> tuple[int, int]:
    revoked_devices = security_service.revoke_all_trusted_devices(db, user_id=user.id)
    revoked_codes = security_service.revoke_backup_codes(db, user_id=user.id)
    return revoked_devices, revoked_codes


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
        two_factor_enabled=current_user.two_factor_enabled,
        mfa_verified=True,
        is_super_admin=auth_service.is_super_admin(current_user),
    )


@router.get("/2fa/status", response_model=TwoFactorStatusResponse)
@limiter.limit("60/minute")
def get_two_factor_status(
    request: Request,
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
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
    _ensure_two_factor_secret(db, current_user)

    otp_code = normalize_totp_code(payload.otp_code)
    if not otp_code or not verify_totp_code(current_user.two_factor_secret, otp_code):
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
    if not current_user.two_factor_enabled or not current_user.two_factor_secret:
        return MessageResponse(message="Two-factor authentication is already disabled.")

    otp_code = normalize_totp_code(payload.current_otp_code)
    if not otp_code or not verify_totp_code(current_user.two_factor_secret, otp_code):
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
    if current_user.two_factor_enabled and current_user.two_factor_secret:
        current_code = normalize_totp_code(payload.current_otp_code)
        if not current_code or not verify_totp_code(current_user.two_factor_secret, current_code):
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


@router.post("/login", response_model=TokenResponse)
@limiter.limit("60/minute")  # General limit (e.g. successful logins from same IP)
@limiter.limit("10/minute", key_func=get_failed_login_key)  # Strict IP limit for brute-force protection
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

    # Check if account is locked
    locked_until = security_service.check_account_locked(user)
    if locked_until:
        raise HTTPException(
            status_code=423,
            detail="บัญชีถูกล็อกชั่วคราวเนื่องจากพยายามเข้าสู่ระบบผิดหลายครั้ง โปรดลองอีกครั้งภายหลังหรือติดต่อผู้ดูแลระบบ",
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

    trusted_device_raw_token: str | None = None
    mfa_verified = not auth_service.requires_token_mfa(authenticated_user)
    if _two_factor_required_for_user(authenticated_user):
        _ensure_two_factor_secret(db, authenticated_user)

        trusted_cookie = _get_trusted_device_cookie(request)
        trusted = None
        if trusted_cookie:
            trusted = security_service.get_active_trusted_device(
                db,
                user_id=authenticated_user.id,
                raw_token=trusted_cookie,
                user_agent=request.headers.get("user-agent"),
            )
            if trusted:
                security_service.mark_trusted_device_used(db, trusted)
                mfa_verified = True

        if not trusted:
            otp_code = normalize_totp_code(payload.otp_code)
            backup_code = normalize_backup_code(payload.otp_code)

            verified = False
            used_backup = False
            if otp_code and verify_totp_code(authenticated_user.two_factor_secret, otp_code):
                verified = True
            elif backup_code and authenticated_user.two_factor_enabled:
                verified = security_service.use_backup_code(
                    db,
                    user_id=authenticated_user.id,
                    code=backup_code,
                )
                used_backup = verified

            if not verified:
                if not payload.otp_code:
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
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid two-factor authentication code",
                    headers={"WWW-Authenticate": "Bearer"},
                )

            mfa_verified = True

            if used_backup:
                db.add(
                    AuditLog(
                        user_id=authenticated_user.id,
                        action="login_with_backup_code",
                        resource_type="user",
                        resource_id=authenticated_user.id,
                        details={"event": "backup_code_login"},
                        ip_address=ip,
                        is_break_glass=False,
                        status="success",
                    )
                )

            if not authenticated_user.two_factor_enabled:
                authenticated_user.two_factor_enabled = True
                authenticated_user.two_factor_enabled_at = datetime.now(timezone.utc)
                db.add(authenticated_user)

            if payload.remember_device:
                trusted_device_raw_token, trusted_device = security_service.create_trusted_device(
                    db,
                    user=authenticated_user,
                    ip_address=ip,
                    user_agent=request.headers.get("user-agent"),
                )
                db.add(
                    AuditLog(
                        user_id=authenticated_user.id,
                        action="trusted_device_created",
                        resource_type="user_trusted_device",
                        resource_id=trusted_device.id,
                        details={"trusted_device_id": str(trusted_device.id)},
                        ip_address=ip,
                        is_break_glass=False,
                        status="success",
                    )
                )

    # Successful login
    security_service.handle_successful_login(db, ip, authenticated_user)
    db.commit()

    login_response = auth_service.create_login_response(
        authenticated_user,
        mfa_verified=mfa_verified,
    )
    _set_auth_cookie(response, login_response["access_token"])
    if trusted_device_raw_token:
        _set_trusted_device_cookie(
            response,
            trusted_device_raw_token,
            max_age_seconds=_trusted_device_days_for_user(authenticated_user) * 24 * 60 * 60,
        )
    return login_response


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("60/minute")
def refresh_token(
    request: Request,
    response: Response,
    current_user: User = Depends(auth_service.get_current_user),
):
    """Refresh access token for authenticated user"""
    refreshed = auth_service.create_login_response(current_user, mfa_verified=True)
    _set_auth_cookie(response, refreshed["access_token"])
    return refreshed


@router.post("/logout")
@limiter.limit("60/minute")
def logout(
    request: Request,
    response: Response,
):
    """Logout endpoint (clears auth cookie)."""
    _clear_auth_cookie(response)
    return {"message": "Successfully logged out"}


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
@limiter.limit("10/minute")
@limiter.limit("5/minute", key_func=get_client_ip_rate_limit_key)
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
    if get_settings().password_reset_return_token_in_response and reset_token:
        response.reset_token = reset_token

    return response


@router.post("/reset-password", response_model=MessageResponse)
@limiter.limit("10/minute")
@limiter.limit("5/minute", key_func=get_client_ip_rate_limit_key)
def reset_password(request: Request, payload: ResetPasswordRequest, db: Session = Depends(auth_service.get_db)):
    ip = _client_ip(request)
    try:
        user_id = auth_service.verify_password_reset_token(payload.token)
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

    user = db.scalar(select(User).where(User.id == parsed_user_id))
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

    auth_service.reset_user_password(db, user, payload.new_password)
    revoked_devices, revoked_codes = _revoke_user_two_factor_artifacts(db, user)
    _write_auth_audit(
        db,
        action="password_reset_completed",
        ip_address=ip,
        status_value="success",
        user=user,
        details={"revoked_devices": revoked_devices, "revoked_backup_codes": revoked_codes},
    )
    db.commit()
    return MessageResponse(message="Password reset successful")


@router.get("/invite/{token}", response_model=InviteInfoResponse)
@limiter.limit("60/minute")
def get_invite_info(request: Request, token: str, db: Session = Depends(auth_service.get_db)):
    invite = auth_service.get_active_invite_by_token(db, token)
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite link is invalid or expired")

    return InviteInfoResponse(email=invite.email, role=invite.role, expires_at=invite.expires_at)


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
            detail="This onboarding flow currently accepts only doctor and medical student invites.",
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
