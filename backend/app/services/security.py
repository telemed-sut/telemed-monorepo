import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.ip_ban import IPBan
from app.models.login_attempt import LoginAttempt
from app.models.user import User

logger = logging.getLogger(__name__)
settings = get_settings()


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def is_ip_whitelisted(ip: str) -> bool:
    whitelist = [s.strip() for s in settings.security_whitelisted_ips.split(",") if s.strip()]
    return ip in whitelist


def record_login_attempt(db: Session, ip: str, email: str, success: bool) -> None:
    attempt = LoginAttempt(ip_address=ip, email=email, success=success)
    db.add(attempt)
    db.flush()


def check_ip_banned(db: Session, ip: str) -> Optional[IPBan]:
    if is_ip_whitelisted(ip):
        return None

    ban = db.scalar(select(IPBan).where(IPBan.ip_address == ip))
    if not ban:
        return None

    now = _now_utc()
    if ban.banned_until and ban.banned_until.replace(tzinfo=timezone.utc if ban.banned_until.tzinfo is None else ban.banned_until.tzinfo) <= now:
        db.delete(ban)
        db.flush()
        return None

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


def handle_failed_login(db: Session, ip: str, email: str, user: Optional[User]) -> None:
    record_login_attempt(db, ip, email, success=False)

    # Increment user failed attempts if user exists
    if user:
        user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
        user.last_failed_login_at = _now_utc()

        if user.failed_login_attempts >= settings.max_login_attempts:
            user.account_locked_until = _now_utc() + timedelta(minutes=settings.account_lockout_minutes)
            logger.warning("Account locked for email=%s after %d failed attempts", email, user.failed_login_attempts)

        db.add(user)

    # Check IP-level threshold (skip whitelisted)
    if not is_ip_whitelisted(ip):
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
            existing_ban = db.scalar(select(IPBan).where(IPBan.ip_address == ip))
            if not existing_ban:
                ban = IPBan(
                    ip_address=ip,
                    reason=f"Exceeded {settings.ip_ban_threshold} failed login attempts in {settings.ip_attempt_window_minutes} minutes",
                    failed_attempts=ip_fail_count,
                    banned_until=_now_utc() + timedelta(minutes=settings.ip_ban_duration_minutes),
                )
                db.add(ban)
                logger.warning("IP %s auto-banned after %d failed attempts", ip, ip_fail_count)
            else:
                existing_ban.failed_attempts = ip_fail_count
                existing_ban.banned_until = _now_utc() + timedelta(minutes=settings.ip_ban_duration_minutes)
                db.add(existing_ban)

    db.flush()


def handle_successful_login(db: Session, ip: str, user: User) -> None:
    record_login_attempt(db, ip, user.email, success=True)

    if user.failed_login_attempts > 0 or user.account_locked_until:
        user.failed_login_attempts = 0
        user.account_locked_until = None
        user.last_failed_login_at = None
        db.add(user)
        db.flush()
