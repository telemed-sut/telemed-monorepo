"""Two-factor session freshness helpers for sensitive operations."""

from datetime import timedelta

from fastapi import HTTPException, Request, status

from app.core.config import get_settings
from app.models.enums import UserRole
from app.models.user import User

from .auth_tokens import _coerce_timestamp, _now_utc

settings = get_settings()


def get_request_auth_payload(request: Request) -> dict[str, object]:
    payload = getattr(request.state, "auth_payload", None)
    return payload if isinstance(payload, dict) else {}


def require_recent_privileged_session(
    request: Request,
    current_user: User,
    *,
    max_age_seconds: int | None = None,
) -> None:
    if current_user.role != UserRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin account required.",
        )

    require_recent_sensitive_session(
        request,
        max_age_seconds=max_age_seconds,
    )


def require_recent_sensitive_session(
    request: Request,
    *,
    max_age_seconds: int | None = None,
    error_status: int = status.HTTP_401_UNAUTHORIZED,
) -> None:
    payload = get_request_auth_payload(request)
    if not bool(payload.get("mfa_verified")):
        raise HTTPException(
            status_code=error_status,
            detail="Recent multi-factor verification required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    mfa_authenticated_at = _coerce_timestamp(payload.get("mfa_authenticated_at"))
    threshold_seconds = max_age_seconds or settings.privileged_action_mfa_max_age_seconds
    if mfa_authenticated_at is None:
        raise HTTPException(
            status_code=error_status,
            detail="Recent multi-factor verification required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if _now_utc() - mfa_authenticated_at > timedelta(seconds=max(threshold_seconds, 1)):
        raise HTTPException(
            status_code=error_status,
            detail="Recent multi-factor verification required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
