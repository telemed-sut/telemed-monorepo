import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.request_utils import is_local_development_ip
from app.models.ip_ban import IPBan
from app.models.login_attempt import LoginAttempt
from app.models.enums import UserRole
from app.models.user import User

logger = logging.getLogger(__name__)
settings = get_settings()


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def cache_ip_ban(ip: str, *, banned_until: datetime) -> None:
    return None


def clear_ip_ban_runtime_state(ip: str) -> None:
    return None


def _get_cached_ip_ban(ip: str) -> datetime | None:
    return None


def _increment_failed_login_counter(ip: str) -> int | None:
    return None


def is_ip_whitelisted(ip: str) -> bool:
    if is_local_development_ip(ip):
        return True

    whitelist = [s.strip() for s in settings.security_whitelisted_ips.split(",") if s.strip()]
    return ip in whitelist


def record_login_attempt(db: Session, ip: str, email: str, success: bool, details: str = None) -> None:
    attempt = LoginAttempt(ip_address=ip, email=email, success=success, details=details)
    db.add(attempt)
    db.flush()


def check_ip_banned(db: Session, ip: str) -> Optional[IPBan]:
    if is_ip_whitelisted(ip):
        return None

    cached_ban_until = _get_cached_ip_ban(ip)
    if cached_ban_until and cached_ban_until > _now_utc():
        return IPBan(ip_address=ip, banned_until=cached_ban_until)

    ban = db.scalar(select(IPBan).where(IPBan.ip_address == ip))
    if not ban:
        return None

    now = _now_utc()
    if ban.banned_until and ban.banned_until.replace(tzinfo=timezone.utc if ban.banned_until.tzinfo is None else ban.banned_until.tzinfo) <= now:
        db.delete(ban)
        db.flush()
        clear_ip_ban_runtime_state(ip)
        return None

    if ban.banned_until:
        cache_ip_ban(ip, banned_until=ban.banned_until)

    return ban


def check_account_locked(user: Optional[User]) -> Optional[datetime]:
    """Returns the lock expiry time if account is locked, None otherwise."""
    if not user:
        return None
    if not user.account_locked_until:
        return None

    locked_until = user.account_locked_until
    if locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=timezone.utc)

    if locked_until <= _now_utc():
        return None

    return locked_until


def _lock_policy_for_user(user: Optional[User]) -> tuple[int, int]:
    if user and user.role == UserRole.admin:
        return settings.admin_max_login_attempts, settings.admin_account_lockout_minutes
    return settings.max_login_attempts, settings.account_lockout_minutes


def _is_clinical_user(user: Optional[User]) -> bool:
    return bool(user and user.role in {UserRole.doctor, UserRole.medical_student})


def _clinical_lockout_seconds(failed_attempts: int) -> int | None:
    if failed_attempts >= settings.clinical_lockout_attempts_step_three:
        return settings.clinical_lockout_seconds_step_three
    if failed_attempts >= settings.clinical_lockout_attempts_step_two:
        return settings.clinical_lockout_seconds_step_two
    if failed_attempts >= settings.clinical_lockout_attempts_step_one:
        return settings.clinical_lockout_seconds_step_one
    return None


def handle_failed_login(db: Session, ip: str, email: str, user: Optional[User], details: str = None) -> None:
    record_login_attempt(db, ip, email, success=False, details=details)

    # Increment user failed attempts if user exists
    if user:
        now = _now_utc()
        user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
        user.last_failed_login_at = now

        if _is_clinical_user(user):
            cooldown_seconds = _clinical_lockout_seconds(user.failed_login_attempts)
            if cooldown_seconds is not None:
                user.account_locked_until = now + timedelta(seconds=cooldown_seconds)
                logger.warning(
                    "Clinical account temporarily locked",
                    extra={
                        "event": "clinical_account_locked",
                        "email": email,
                        "failed_attempts": user.failed_login_attempts,
                        "cooldown_seconds": cooldown_seconds,
                    },
                )
        else:
            max_attempts, lockout_minutes = _lock_policy_for_user(user)
            if user.failed_login_attempts >= max_attempts:
                user.account_locked_until = now + timedelta(minutes=lockout_minutes)
                logger.warning(
                    "Account locked after repeated failed attempts",
                    extra={
                        "event": "account_locked",
                        "email": email,
                        "failed_attempts": user.failed_login_attempts,
                        "max_attempts": max_attempts,
                        "lockout_minutes": lockout_minutes,
                    },
                )

        db.add(user)

    # Check IP-level threshold (skip whitelisted)
    if not is_ip_whitelisted(ip):
        ip_fail_count = _increment_failed_login_counter(ip)
        if ip_fail_count is None:
            window_start = _now_utc() - timedelta(minutes=settings.ip_attempt_window_minutes)
            ip_fail_count = db.scalar(
                select(func.count())
                .select_from(LoginAttempt)
                .where(
                    LoginAttempt.ip_address == ip,
                    LoginAttempt.success == False,  # noqa: E712
                    LoginAttempt.created_at >= window_start,
                )
            ) or 0

        if ip_fail_count >= settings.ip_ban_threshold:
            banned_until = _now_utc() + timedelta(minutes=settings.ip_ban_duration_minutes)
            cache_ip_ban(ip, banned_until=banned_until)
            existing_ban = db.scalar(select(IPBan).where(IPBan.ip_address == ip))
            if not existing_ban:
                ban = IPBan(
                    ip_address=ip,
                    reason=f"Exceeded {settings.ip_ban_threshold} failed login attempts in {settings.ip_attempt_window_minutes} minutes",
                    failed_attempts=ip_fail_count,
                    banned_until=banned_until,
                )
                db.add(ban)
                logger.warning("Login source auto-banned after repeated failed attempts")
            else:
                existing_ban.failed_attempts = ip_fail_count
                existing_ban.banned_until = banned_until
                db.add(existing_ban)

    db.flush()


def handle_successful_login(db: Session, ip: str, user: User) -> None:
    record_login_attempt(db, ip, user.email, success=True, details="Login successful")

    if user.failed_login_attempts > 0 or user.account_locked_until:
        user.failed_login_attempts = 0
        user.account_locked_until = None
        user.last_failed_login_at = None
        db.add(user)
        db.flush()
