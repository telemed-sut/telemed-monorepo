"""Token creation and validation helpers for authentication flows."""

import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status
from jose import JWTError

from app.core.config import get_settings
from app.core.security import create_access_token, decode_token
from app.models.enums import UserRole
from app.models.user import User
from app.services import auth_sessions
from app.services.auth_privileges import requires_token_mfa

settings = get_settings()


@dataclass(frozen=True)
class PasswordResetTokenClaims:
    user_id: str
    issued_at: datetime | None
    password_changed_marker: int | None


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_dt(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _coerce_timestamp(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return _normalize_dt(value)
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc)
    return None


def _get_password_changed_marker(user: User) -> int | None:
    if not user.password_changed_at:
        return None
    normalized = _normalize_dt(user.password_changed_at)
    return int(normalized.timestamp() * 1_000_000)


def is_recent_mfa_authenticated(
    mfa_authenticated_at: datetime | None,
    *,
    max_age_seconds: int | None = None,
) -> bool:
    if mfa_authenticated_at is None:
        return False
    threshold_seconds = max_age_seconds or settings.privileged_action_mfa_max_age_seconds
    return _now_utc() - mfa_authenticated_at <= timedelta(seconds=max(threshold_seconds, 1))


def get_access_token_ttl_seconds(user: User | None) -> int:
    if user and user.role == UserRole.admin:
        return settings.admin_jwt_expires_in
    return settings.jwt_expires_in


def create_login_response(
    user: User,
    *,
    db=None,
    mfa_verified: bool = True,
    mfa_authenticated_at: datetime | None = None,
    auth_source: str = "local",
    sso_provider: str | None = None,
    session_id: str | None = None,
) -> dict:
    expires_in = get_access_token_ttl_seconds(user)
    effective_mfa_verified = not requires_token_mfa(user) or bool(mfa_verified)
    auth_time = mfa_authenticated_at
    if effective_mfa_verified and auth_time is None:
        auth_time = _now_utc()
    effective_session_id = session_id or secrets.token_urlsafe(16)
    token = create_access_token(
        {
            "sub": str(user.id),
            "role": user.role.value,
            "type": "access",
            "mfa_verified": effective_mfa_verified,
            "mfa_authenticated_at": int(auth_time.timestamp()) if auth_time else None,
            "auth_source": auth_source,
            "sso_provider": sso_provider,
            "session_id": effective_session_id,
        },
        expires_in=expires_in,
    )
    if db is not None:
        auth_sessions.register_session(
            db,
            user_id=user.id,
            session_id=effective_session_id,
            auth_source=auth_source,
            expires_in_seconds=expires_in,
        )
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": expires_in,
        "session_id": effective_session_id,
        "user": {
            "id": str(user.id),
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "role": user.role.value,
            "verification_status": user.verification_status.value if user.verification_status else None,
            "two_factor_enabled": bool(user.two_factor_enabled),
            "mfa_verified": effective_mfa_verified,
            "mfa_authenticated_at": auth_time,
            "mfa_recent_for_privileged_actions": is_recent_mfa_authenticated(auth_time),
            "auth_source": auth_source,
            "sso_provider": sso_provider,
        },
    }


def create_password_reset_token(user: User) -> str:
    payload = {
        "sub": str(user.id),
        "type": "password_reset",
        "pwdv": _get_password_changed_marker(user),
    }
    return create_access_token(payload, expires_in=settings.password_reset_expires_in)


def parse_password_reset_token(token: str) -> PasswordResetTokenClaims:
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
        issued_at = _coerce_timestamp(payload.get("iat"))
        password_changed_marker = payload.get("pwdv")
        return PasswordResetTokenClaims(
            user_id=str(user_id),
            issued_at=issued_at,
            password_changed_marker=int(password_changed_marker)
            if isinstance(password_changed_marker, (int, float))
            else None,
        )
    except JWTError:
        raise credentials_exception


def verify_password_reset_token(token: str) -> str:
    return parse_password_reset_token(token).user_id


def is_password_reset_token_stale(
    user: User,
    *,
    issued_at: datetime | None,
    password_changed_marker: int | None = None,
) -> bool:
    current_password_changed_marker = _get_password_changed_marker(user)
    if password_changed_marker is not None:
        return current_password_changed_marker != password_changed_marker
    if issued_at is None:
        return True
    password_changed_at = _normalize_dt(user.password_changed_at) if user.password_changed_at else None
    return bool(password_changed_at and issued_at < password_changed_at)


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
