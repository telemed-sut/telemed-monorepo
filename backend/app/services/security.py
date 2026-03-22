import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import (
    generate_backup_code,
    generate_security_token,
    hash_security_token,
    normalize_backup_code,
)
from app.models.ip_ban import IPBan
from app.models.login_attempt import LoginAttempt
from app.models.enums import UserRole
from app.models.user_backup_code import UserBackupCode
from app.models.user_trusted_device import UserTrustedDevice
from app.models.user import User

logger = logging.getLogger(__name__)
settings = get_settings()


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def is_ip_whitelisted(ip: str) -> bool:
    whitelist = [s.strip() for s in settings.security_whitelisted_ips.split(",") if s.strip()]
    return ip in whitelist


def is_admin_unlock_ip_whitelisted(ip: str) -> bool:
    whitelist = settings.admin_unlock_whitelisted_ips
    if isinstance(whitelist, str):
        allowed_ips = [s.strip() for s in whitelist.split(",") if s.strip()]
    else:
        allowed_ips = [s.strip() for s in whitelist if s and s.strip()]
    return ip in allowed_ips


def record_login_attempt(db: Session, ip: str, email: str, success: bool, details: str = None) -> None:
    attempt = LoginAttempt(ip_address=ip, email=email, success=success, details=details)
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


def _lock_policy_for_user(user: Optional[User]) -> tuple[int, int]:
    if user and user.role == UserRole.admin:
        return settings.admin_max_login_attempts, settings.admin_account_lockout_minutes
    return settings.max_login_attempts, settings.account_lockout_minutes


def handle_failed_login(db: Session, ip: str, email: str, user: Optional[User], details: str = None) -> None:
    record_login_attempt(db, ip, email, success=False, details=details)

    # Increment user failed attempts if user exists
    if user:
        max_attempts, lockout_minutes = _lock_policy_for_user(user)
        user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
        user.last_failed_login_at = _now_utc()

        if user.failed_login_attempts >= max_attempts:
            user.account_locked_until = _now_utc() + timedelta(minutes=lockout_minutes)
            logger.warning(
                "Account locked for email=%s after %d failed attempts (policy=%d/%dmin)",
                email,
                user.failed_login_attempts,
                max_attempts,
                lockout_minutes,
            )

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
                logger.warning("Login source auto-banned after repeated failed attempts")
            else:
                existing_ban.failed_attempts = ip_fail_count
                existing_ban.banned_until = _now_utc() + timedelta(minutes=settings.ip_ban_duration_minutes)
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


def hash_user_agent(user_agent: str | None) -> str | None:
    if not user_agent:
        return None
    return hash_security_token(user_agent)


def trusted_device_days_for_user(user: User) -> int:
    if user.role == UserRole.admin:
        return settings.admin_trusted_device_days
    return settings.user_trusted_device_days


def create_trusted_device(
    db: Session,
    *,
    user: User,
    ip_address: str | None,
    user_agent: str | None,
) -> tuple[str, UserTrustedDevice]:
    raw_token = generate_security_token(32)
    token_hash = hash_security_token(raw_token)
    now = _now_utc()
    expires_at = now + timedelta(days=trusted_device_days_for_user(user))
    trusted = UserTrustedDevice(
        user_id=user.id,
        token_hash=token_hash,
        user_agent_hash=hash_user_agent(user_agent),
        ip_address=ip_address,
        created_at=now,
        expires_at=expires_at,
    )
    db.add(trusted)
    db.flush()
    return raw_token, trusted


def get_active_trusted_device(
    db: Session,
    *,
    user_id: UUID,
    raw_token: str,
    user_agent: str | None,
) -> Optional[UserTrustedDevice]:
    token_hash = hash_security_token(raw_token)
    now = _now_utc()
    trusted = db.scalar(
        select(UserTrustedDevice).where(
            UserTrustedDevice.user_id == user_id,
            UserTrustedDevice.token_hash == token_hash,
            UserTrustedDevice.revoked_at.is_(None),
            UserTrustedDevice.expires_at > now,
        )
    )
    if not trusted:
        return None

    expected_ua = trusted.user_agent_hash
    if expected_ua and expected_ua != hash_user_agent(user_agent):
        return None
    return trusted


def mark_trusted_device_used(db: Session, trusted_device: UserTrustedDevice) -> None:
    trusted_device.last_used_at = _now_utc()
    db.add(trusted_device)
    db.flush()


def revoke_all_trusted_devices(db: Session, *, user_id: UUID) -> int:
    now = _now_utc()
    devices = db.scalars(
        select(UserTrustedDevice).where(
            UserTrustedDevice.user_id == user_id,
            UserTrustedDevice.revoked_at.is_(None),
        )
    ).all()
    for device in devices:
        device.revoked_at = now
        db.add(device)
    db.flush()
    return len(devices)


def revoke_trusted_device(db: Session, *, user_id: UUID, device_id: UUID) -> bool:
    device = db.scalar(
        select(UserTrustedDevice).where(
            UserTrustedDevice.id == device_id,
            UserTrustedDevice.user_id == user_id,
            UserTrustedDevice.revoked_at.is_(None),
        )
    )
    if not device:
        return False
    device.revoked_at = _now_utc()
    db.add(device)
    db.flush()
    return True


def generate_backup_codes(
    db: Session,
    *,
    user_id: UUID,
) -> tuple[list[str], datetime | None]:
    # Revoke old unused codes first.
    revoke_backup_codes(db, user_id=user_id)

    now = _now_utc()
    batch_id = uuid4()
    expires_at: datetime | None = None
    if settings.backup_code_expires_days > 0:
        expires_at = now + timedelta(days=settings.backup_code_expires_days)

    plain_codes: list[str] = []
    for _ in range(max(1, settings.backup_code_count)):
        code = generate_backup_code(10)
        plain_codes.append(code)
        db.add(
            UserBackupCode(
                user_id=user_id,
                code_hash=hash_security_token(code),
                batch_id=batch_id,
                expires_at=expires_at,
            )
        )
    db.flush()
    return plain_codes, expires_at


def revoke_backup_codes(db: Session, *, user_id: UUID) -> int:
    now = _now_utc()
    items = db.scalars(
        select(UserBackupCode).where(
            UserBackupCode.user_id == user_id,
            UserBackupCode.used_at.is_(None),
        )
    ).all()
    for item in items:
        item.used_at = now
        db.add(item)
    db.flush()
    return len(items)


def use_backup_code(db: Session, *, user_id: UUID, code: str) -> bool:
    normalized = normalize_backup_code(code)
    if not normalized:
        return False

    now = _now_utc()
    code_hash = hash_security_token(normalized)
    item = db.scalar(
        select(UserBackupCode).where(
            UserBackupCode.user_id == user_id,
            UserBackupCode.code_hash == code_hash,
            UserBackupCode.used_at.is_(None),
            (UserBackupCode.expires_at.is_(None)) | (UserBackupCode.expires_at > now),
        )
    )
    if not item:
        return False

    item.used_at = now
    db.add(item)
    db.flush()
    return True
