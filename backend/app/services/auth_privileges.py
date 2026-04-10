import logging
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.enums import PrivilegedRole, UserRole
from app.models.user import User
from app.models.user_privileged_role_assignment import UserPrivilegedRoleAssignment
from app.services import admin_sso

settings = get_settings()
logger = logging.getLogger(__name__)


def requires_token_mfa(user: User | None) -> bool:
    if user is None:
        return False
    return (settings.admin_2fa_required and user.role == UserRole.admin) or bool(user.two_factor_enabled)


def is_admin_sso_enforced_for_user(user: User | None) -> bool:
    return bool(
        user
        and user.role == UserRole.admin
        and admin_sso.is_enforced()
        and not is_bootstrap_super_admin(user)
    )


def _normalize_super_admin_emails() -> set[str]:
    raw_super_admins = get_settings().super_admin_emails
    if isinstance(raw_super_admins, str):
        return {email.strip().lower() for email in raw_super_admins.split(",") if email.strip()}
    return {email.strip().lower() for email in raw_super_admins if email and email.strip()}


def is_bootstrap_super_admin(user: Optional[User]) -> bool:
    if not user or user.role != UserRole.admin:
        return False
    return user.email.lower() in _normalize_super_admin_emails()


def list_active_privileged_roles(db: Session | None, user: User | None) -> set[PrivilegedRole]:
    if db is None or user is None:
        return set()
    rows = db.scalars(
        select(UserPrivilegedRoleAssignment.role).where(
            UserPrivilegedRoleAssignment.user_id == user.id,
            UserPrivilegedRoleAssignment.revoked_at.is_(None),
        )
    ).all()
    return {row for row in rows if isinstance(row, PrivilegedRole)}


def can_manage_privileged_admins(user: Optional[User], db: Session | None = None) -> bool:
    if not user or user.role != UserRole.admin:
        return False
    roles = list_active_privileged_roles(db, user)
    return PrivilegedRole.platform_super_admin in roles or is_bootstrap_super_admin(user)


def can_manage_security_recovery(user: Optional[User], db: Session | None = None) -> bool:
    if not user or user.role != UserRole.admin:
        return False
    roles = list_active_privileged_roles(db, user)
    return bool(
        PrivilegedRole.platform_super_admin in roles
        or PrivilegedRole.security_admin in roles
        or is_bootstrap_super_admin(user)
    )


def build_privilege_flags(db: Session | None, user: User | None) -> dict[str, Any]:
    active_roles = list_active_privileged_roles(db, user)
    is_bootstrap = is_bootstrap_super_admin(user)
    can_manage_privileged = bool(
        user
        and user.role == UserRole.admin
        and (PrivilegedRole.platform_super_admin in active_roles or is_bootstrap)
    )
    can_manage_recovery = bool(
        user
        and user.role == UserRole.admin
        and (
            PrivilegedRole.platform_super_admin in active_roles
            or PrivilegedRole.security_admin in active_roles
            or is_bootstrap
        )
    )
    return {
        "is_super_admin": can_manage_privileged,
        "privileged_roles": sorted(role.value for role in active_roles),
        "can_manage_privileged_admins": can_manage_privileged,
        "can_manage_security_recovery": can_manage_recovery,
        "can_bootstrap_privileged_roles": is_bootstrap,
    }


def resolve_privileged_access_class(db: Session | None, user: User | None) -> str | None:
    if not user or user.role != UserRole.admin:
        return None

    active_roles = list_active_privileged_roles(db, user)
    if PrivilegedRole.platform_super_admin in active_roles or is_bootstrap_super_admin(user):
        return "Vault Apex"
    if PrivilegedRole.security_admin in active_roles:
        return "Vault Prime"
    if PrivilegedRole.hospital_admin in active_roles:
        return "Vault"
    return None


def build_access_profile(
    db: Session | None,
    user: User | None,
    *,
    reveal_sensitive_details: bool,
) -> dict[str, Any]:
    privilege_flags = build_privilege_flags(db, user)
    has_privileged_access = bool(
        privilege_flags["privileged_roles"] or privilege_flags["can_bootstrap_privileged_roles"]
    )

    return {
        "has_privileged_access": has_privileged_access,
        "access_class": (
            resolve_privileged_access_class(db, user)
            if reveal_sensitive_details and has_privileged_access
            else None
        ),
        "access_class_revealed": bool(reveal_sensitive_details and has_privileged_access),
        "can_manage_privileged_admins": (
            privilege_flags["can_manage_privileged_admins"] if reveal_sensitive_details else False
        ),
        "can_manage_security_recovery": (
            privilege_flags["can_manage_security_recovery"] if reveal_sensitive_details else False
        ),
        "can_bootstrap_privileged_roles": (
            privilege_flags["can_bootstrap_privileged_roles"] if reveal_sensitive_details else False
        ),
    }


def backfill_bootstrap_privileged_roles(db: Session) -> int:
    bootstrap_emails = sorted(_normalize_super_admin_emails())
    if not bootstrap_emails:
        return 0

    admins = db.scalars(
        select(User).where(
            User.role == UserRole.admin,
            User.deleted_at.is_(None),
            User.email.in_(bootstrap_emails),
        )
    ).all()
    admin_by_email = {admin.email.lower(): admin for admin in admins}

    for email in bootstrap_emails:
        if email not in admin_by_email:
            logger.warning(
                "Bootstrap privileged-role backfill skipped missing admin account",
                extra={"email": email},
            )

    created = 0
    for email in bootstrap_emails:
        admin = admin_by_email.get(email)
        if admin is None:
            continue
        insert_factory = sqlite_insert if db.bind and db.bind.dialect.name == "sqlite" else pg_insert
        stmt = insert_factory(UserPrivilegedRoleAssignment).values(
            user_id=admin.id,
            role=PrivilegedRole.platform_super_admin,
            created_by=None,
            reason="bootstrap_backfill_from_super_admin_emails",
        )
        stmt = stmt.on_conflict_do_nothing(
            index_elements=["user_id", "role"],
            index_where=UserPrivilegedRoleAssignment.revoked_at.is_(None),
        )
        result = db.execute(stmt)
        if result.rowcount and result.rowcount > 0:
            created += 1

    if created:
        db.flush()
    return created
