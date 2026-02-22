import argparse
import json
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.audit_log import AuditLog
from app.models.enums import UserRole
from app.models.user import User


def _to_set(value):
    if isinstance(value, str):
        return {item.strip().lower() for item in value.split(",") if item.strip()}
    return {item.strip().lower() for item in value if item and item.strip()}


def main() -> int:
    parser = argparse.ArgumentParser(description="Emergency unlock for admin account.")
    parser.add_argument("--email", required=True, help="Admin email to unlock")
    parser.add_argument("--reason", default="Emergency unlock via script")
    parser.add_argument("--requester-email", help="Super admin email performing the action")
    parser.add_argument("--requester-ip", default="127.0.0.1", help="Requester IP")
    args = parser.parse_args()

    settings = get_settings()
    super_admins = _to_set(settings.super_admin_emails)
    whitelisted_ips = _to_set(settings.admin_unlock_whitelisted_ips)

    requester_email = (args.requester_email or "").strip().lower()
    requester_ip = (args.requester_ip or "").strip()
    authorized_by_super_admin = requester_email in super_admins if requester_email else False
    authorized_by_ip = requester_ip.lower() in whitelisted_ips

    db = SessionLocal()
    try:
        def audit(success: bool, message: str, target: User | None = None) -> None:
            details = {
                "success": success,
                "message": message,
                "authorized_by": "super_admin" if authorized_by_super_admin else (
                    "whitelisted_ip" if authorized_by_ip else "none"
                ),
                "actor_email": requester_email,
                "target_email": args.email.strip().lower(),
                "reason": args.reason,
            }
            db.add(
                AuditLog(
                    user_id=None,
                    action="admin_emergency_unlock",
                    resource_type="user",
                    resource_id=target.id if target else None,
                    details=json.dumps(details),
                    ip_address=requester_ip,
                    is_break_glass=False,
                    status="success" if success else "failure",
                )
            )
            db.commit()

        if not authorized_by_super_admin and not authorized_by_ip:
            audit(False, "Authorization failed for emergency unlock")
            print("Authorization failed: requires super admin email or whitelisted IP.")
            return 1

        target_email = args.email.strip().lower()
        target = db.scalar(
            select(User).where(User.email == target_email, User.deleted_at.is_(None)).with_for_update()
        )
        if not target:
            audit(False, "Target user not found")
            print(f"User not found: {target_email}")
            return 1
        if target.role != UserRole.admin:
            audit(False, "Target user is not admin", target)
            print(f"User is not admin: {target_email}")
            return 1

        now = datetime.now(timezone.utc)
        locked_until = target.account_locked_until
        if locked_until and locked_until.tzinfo is None:
            locked_until = locked_until.replace(tzinfo=timezone.utc)
        was_locked = bool((locked_until and locked_until > now) or (target.failed_login_attempts or 0) > 0)

        target.failed_login_attempts = 0
        target.last_failed_login_at = None
        target.account_locked_until = None
        db.add(target)
        db.flush()
        audit(True, "Admin emergency unlock via script", target)

        print(
            f"Unlocked admin account: {target.email} "
            f"(was_locked={'yes' if was_locked else 'no'})"
        )
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
