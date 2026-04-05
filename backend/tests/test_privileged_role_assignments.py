from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import generate_totp_secret, get_password_hash
from app.models.enums import PrivilegedRole, UserRole
from app.models.user import User
from app.models.user_privileged_role_assignment import UserPrivilegedRoleAssignment
from app.services.auth import backfill_bootstrap_privileged_roles, create_login_response


def _make_user(
    db: Session,
    *,
    email: str,
    role: UserRole = UserRole.admin,
    password: str = "TestPass123",
) -> User:
    user = User(
        email=email,
        password_hash=get_password_hash(password),
        role=role,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _login(client: TestClient, email: str, password: str = "TestPass123") -> str:
    response = client.post("/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _grant_privileged_role(
    db: Session,
    *,
    user: User,
    role: PrivilegedRole,
    created_by: User | None = None,
    reason: str = "bootstrap assignment for tests",
) -> UserPrivilegedRoleAssignment:
    assignment = UserPrivilegedRoleAssignment(
        user_id=user.id,
        role=role,
        created_by=created_by.id if created_by else None,
        reason=reason,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return assignment


def test_bootstrap_admin_can_create_privileged_role_assignment(client: TestClient, db: Session):
    bootstrap_admin = _make_user(db, email="admin@example.com", role=UserRole.admin)
    target_admin = _make_user(db, email="sec-admin@example.com", role=UserRole.admin)

    token = _login(client, bootstrap_admin.email)
    response = client.post(
        "/security/privileged-role-assignments",
        json={
            "user_id": str(target_admin.id),
            "role": "security_admin",
            "reason": "Initial hospital security admin bootstrap",
        },
        headers=_auth(token),
    )

    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["user_id"] == str(target_admin.id)
    assert payload["role"] == "security_admin"


def test_platform_super_admin_assignment_can_create_admin_invite(client: TestClient, db: Session):
    bootstrap_admin = _make_user(db, email="admin@example.com", role=UserRole.admin)
    delegated_admin = _make_user(db, email="delegated-platform@example.com", role=UserRole.admin)

    _grant_privileged_role(
        db,
        user=delegated_admin,
        role=PrivilegedRole.platform_super_admin,
        created_by=bootstrap_admin,
    )

    token = _login(client, delegated_admin.email)
    response = client.post(
        "/users/invites",
        json={
            "email": "new-admin@hospital.org",
            "role": "admin",
            "reason": "Initial delegated admin onboarding",
        },
        headers=_auth(token),
    )

    assert response.status_code == 200, response.text
    assert "/invite#token=" in response.json()["invite_url"]


def test_security_admin_can_run_recovery_actions(client: TestClient, db: Session):
    bootstrap_admin = _make_user(db, email="admin@example.com", role=UserRole.admin)
    security_admin = _make_user(db, email="security-admin@example.com", role=UserRole.admin)
    target_admin = _make_user(db, email="locked-admin@example.com", role=UserRole.admin)
    target_admin.failed_login_attempts = 7
    target_admin.account_locked_until = datetime.now(timezone.utc) + timedelta(minutes=5)
    db.add(target_admin)
    db.commit()

    _grant_privileged_role(
        db,
        user=security_admin,
        role=PrivilegedRole.security_admin,
        created_by=bootstrap_admin,
    )

    token = _login(client, security_admin.email)
    unlock = client.post(
        "/security/admin-unlock",
        json={"email": target_admin.email, "reason": "Emergency admin access recovery"},
        headers=_auth(token),
    )
    assert unlock.status_code == 200, unlock.text

    password_reset = client.post(
        f"/security/users/{target_admin.id}/password/reset",
        json={"reason": "Emergency account recovery after lockout"},
        headers=_auth(token),
    )
    assert password_reset.status_code == 200, password_reset.text
    assert password_reset.json()["reset_token"]


def test_security_recovery_actions_require_fresh_high_risk_mfa(client: TestClient, db: Session):
    bootstrap_admin = _make_user(db, email="admin@example.com", role=UserRole.admin)
    security_admin = _make_user(db, email="stale-security-admin@example.com", role=UserRole.admin)
    target_admin = _make_user(db, email="stale-target-admin@example.com", role=UserRole.admin)

    _grant_privileged_role(
        db,
        user=security_admin,
        role=PrivilegedRole.security_admin,
        created_by=bootstrap_admin,
    )

    stale_response = create_login_response(
        security_admin,
        db=db,
        mfa_verified=True,
        mfa_authenticated_at=datetime.now(timezone.utc) - timedelta(hours=1),
    )
    response = client.post(
        f"/security/users/{target_admin.id}/2fa/reset",
        json={"reason": "High risk action should require fresher MFA"},
        headers=_auth(stale_response["access_token"]),
    )

    assert response.status_code == 401
    assert "Recent multi-factor verification required" in response.json()["detail"]


def test_hospital_admin_cannot_run_recovery_actions(client: TestClient, db: Session):
    bootstrap_admin = _make_user(db, email="admin@example.com", role=UserRole.admin)
    hospital_admin = _make_user(db, email="hospital-admin@example.com", role=UserRole.admin)
    target_user = _make_user(db, email="target@example.com", role=UserRole.medical_student)

    _grant_privileged_role(
        db,
        user=hospital_admin,
        role=PrivilegedRole.hospital_admin,
        created_by=bootstrap_admin,
    )

    token = _login(client, hospital_admin.email)
    response = client.post(
        f"/security/users/{target_user.id}/2fa/reset",
        json={"reason": "Should be denied"},
        headers=_auth(token),
    )

    assert response.status_code == 403


def test_revoked_privileged_assignment_loses_access(client: TestClient, db: Session):
    bootstrap_admin = _make_user(db, email="admin@example.com", role=UserRole.admin)
    delegated_admin = _make_user(db, email="revoked-platform@example.com", role=UserRole.admin)
    assignment = _grant_privileged_role(
        db,
        user=delegated_admin,
        role=PrivilegedRole.platform_super_admin,
        created_by=bootstrap_admin,
    )

    bootstrap_token = _login(client, bootstrap_admin.email)
    revoke = client.post(
        f"/security/privileged-role-assignments/{assignment.id}/revoke",
        json={"reason": "Rotation of privileged duties"},
        headers=_auth(bootstrap_token),
    )
    assert revoke.status_code == 200, revoke.text

    delegated_token = _login(client, delegated_admin.email)
    response = client.post(
        "/users/invites",
        json={
            "email": "revoked-admin@hospital.org",
            "role": "admin",
            "reason": "This should be denied after revocation",
        },
        headers=_auth(delegated_token),
    )
    assert response.status_code == 403


def test_privileged_actions_require_recent_mfa(client: TestClient, db: Session):
    bootstrap_admin = _make_user(db, email="admin@example.com", role=UserRole.admin)
    delegated_admin = _make_user(db, email="recent-mfa@example.com", role=UserRole.admin)
    _grant_privileged_role(
        db,
        user=delegated_admin,
        role=PrivilegedRole.platform_super_admin,
        created_by=bootstrap_admin,
    )

    stale_response = create_login_response(
        delegated_admin,
        db=db,
        mfa_verified=True,
        mfa_authenticated_at=datetime.now(timezone.utc) - timedelta(hours=1),
    )
    response = client.post(
        "/users/invites",
        json={
            "email": "stale-admin@hospital.org",
            "role": "admin",
            "reason": "Recent MFA policy regression check",
        },
        headers=_auth(stale_response["access_token"]),
    )

    assert response.status_code == 401
    assert "Recent multi-factor verification required" in response.json()["detail"]


def test_access_profile_reveals_db_backed_privileged_access(client: TestClient, db: Session):
    bootstrap_admin = _make_user(db, email="admin@example.com", role=UserRole.admin)
    delegated_admin = _make_user(db, email="db-flags@example.com", role=UserRole.admin)
    _grant_privileged_role(
        db,
        user=delegated_admin,
        role=PrivilegedRole.platform_super_admin,
        created_by=bootstrap_admin,
    )
    _grant_privileged_role(
        db,
        user=delegated_admin,
        role=PrivilegedRole.security_admin,
        created_by=bootstrap_admin,
    )

    token = _login(client, delegated_admin.email)
    response = client.get("/auth/access-profile", headers=_auth(token))

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["has_privileged_access"] is True
    assert payload["access_class"] == "Vault Apex"
    assert payload["access_class_revealed"] is True
    assert payload["can_manage_privileged_admins"] is True
    assert payload["can_manage_security_recovery"] is True


def test_access_profile_hides_sensitive_details_without_recent_mfa(client: TestClient, db: Session):
    bootstrap_admin = _make_user(db, email="admin@example.com", role=UserRole.admin)
    delegated_admin = _make_user(db, email="stale-mfa@example.com", role=UserRole.admin)
    _grant_privileged_role(
        db,
        user=delegated_admin,
        role=PrivilegedRole.security_admin,
        created_by=bootstrap_admin,
    )

    stale_auth_time = datetime.now(timezone.utc) - timedelta(hours=5)
    token = create_login_response(
        delegated_admin,
        db=db,
        mfa_verified=True,
        mfa_authenticated_at=stale_auth_time,
    )["access_token"]
    response = client.get("/auth/access-profile", headers=_auth(token))

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["has_privileged_access"] is True
    assert payload["access_class"] is None
    assert payload["access_class_revealed"] is False
    assert payload["can_manage_privileged_admins"] is False
    assert payload["can_manage_security_recovery"] is False


def test_backfill_bootstrap_privileged_roles_assigns_platform_super_admin(monkeypatch, db: Session):
    admin = _make_user(db, email="bootstrap-admin@example.com", role=UserRole.admin)
    _make_user(db, email="non-bootstrap-admin@example.com", role=UserRole.admin)

    monkeypatch.setenv("SUPER_ADMIN_EMAILS", "bootstrap-admin@example.com,missing@example.com")
    from app.core.config import get_settings
    get_settings.cache_clear()

    created = backfill_bootstrap_privileged_roles(db)
    db.commit()

    assignments = db.scalars(
        select(UserPrivilegedRoleAssignment).where(
            UserPrivilegedRoleAssignment.user_id == admin.id,
            UserPrivilegedRoleAssignment.revoked_at.is_(None),
        )
    ).all()

    assert created == 1
    assert len(assignments) == 1
    assert assignments[0].role == PrivilegedRole.platform_super_admin
    assert assignments[0].created_by is None
    assert assignments[0].reason == "bootstrap_backfill_from_super_admin_emails"

    rerun_created = backfill_bootstrap_privileged_roles(db)
    assert rerun_created == 0

    get_settings.cache_clear()
