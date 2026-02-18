"""Tests for admin-only security policy hardening."""

import json
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import auth as auth_api
from app.core.security import generate_totp_code, generate_totp_secret, get_password_hash
from app.models.audit_log import AuditLog
from app.models.enums import UserRole
from app.models.user import User


def _make_user(db: Session, *, email: str, role: UserRole = UserRole.staff, password: str = "TestPass123") -> User:
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


def _login(client: TestClient, email: str, password: str = "TestPass123", otp_code: str | None = None):
    payload = {"email": email, "password": password}
    if otp_code:
        payload["otp_code"] = otp_code
    return client.post("/auth/login", json=payload)


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_admin_login_requires_2fa_code(client: TestClient, db: Session, monkeypatch):
    monkeypatch.setattr(auth_api.settings, "admin_2fa_required", True)
    _make_user(db, email="twofa-admin@example.com", role=UserRole.admin)

    response = _login(client, "twofa-admin@example.com")
    assert response.status_code == 401
    detail = response.json()["detail"]
    assert detail["code"] == "two_factor_required"
    assert detail["setup_required"] is True
    assert "provisioning_uri" in detail


def test_admin_login_with_valid_2fa_code_succeeds(client: TestClient, db: Session, monkeypatch):
    monkeypatch.setattr(auth_api.settings, "admin_2fa_required", True)
    secret = generate_totp_secret()
    admin = _make_user(db, email="twofa-ok@example.com", role=UserRole.admin)
    admin.two_factor_secret = secret
    admin.two_factor_enabled = True
    admin.two_factor_enabled_at = datetime.now(timezone.utc)
    db.add(admin)
    db.commit()

    otp_code = generate_totp_code(secret)
    response = _login(client, "twofa-ok@example.com", otp_code=otp_code)
    assert response.status_code == 200, response.text
    assert "access_token" in response.json()


def test_emergency_unlock_admin_requires_super_admin_or_whitelisted_ip(
    client: TestClient,
    db: Session,
):
    _make_user(db, email="normal-admin@example.com", role=UserRole.admin)
    target = _make_user(db, email="locked-admin-a@example.com", role=UserRole.admin)
    target.failed_login_attempts = 8
    target.account_locked_until = datetime.now(timezone.utc) + timedelta(minutes=5)
    db.add(target)
    db.commit()

    token = _login(client, "normal-admin@example.com").json()["access_token"]
    response = client.post(
        "/security/admin-unlock",
        json={"email": "locked-admin-a@example.com", "reason": "manual test"},
        headers=_auth(token),
    )
    assert response.status_code == 403

    log = db.scalar(
        select(AuditLog)
        .where(AuditLog.action == "admin_emergency_unlock")
        .order_by(AuditLog.created_at.desc())
    )
    assert log is not None
    assert json.loads(log.details)["success"] is False


def test_super_admin_can_emergency_unlock_admin(client: TestClient, db: Session):
    _make_user(db, email="admin@example.com", role=UserRole.admin)
    target = _make_user(db, email="locked-admin-b@example.com", role=UserRole.admin)
    target.failed_login_attempts = 12
    target.account_locked_until = datetime.now(timezone.utc) + timedelta(minutes=5)
    db.add(target)
    db.commit()

    token = _login(client, "admin@example.com").json()["access_token"]
    response = client.post(
        "/security/admin-unlock",
        json={"email": "locked-admin-b@example.com", "reason": "unlock test"},
        headers=_auth(token),
    )
    assert response.status_code == 200
    assert response.json()["email"] == "locked-admin-b@example.com"

    db.refresh(target)
    assert target.failed_login_attempts == 0
    assert target.account_locked_until is None


def test_trusted_device_bypasses_2fa_challenge(client: TestClient, db: Session, monkeypatch):
    monkeypatch.setattr(auth_api.settings, "admin_2fa_required", True)
    admin = _make_user(db, email="trusted-admin@example.com", role=UserRole.admin)
    secret = generate_totp_secret()
    admin.two_factor_secret = secret
    admin.two_factor_enabled = True
    admin.two_factor_enabled_at = datetime.now(timezone.utc)
    db.add(admin)
    db.commit()

    first = client.post(
        "/auth/login",
        json={
            "email": "trusted-admin@example.com",
            "password": "TestPass123",
            "otp_code": generate_totp_code(secret),
            "remember_device": True,
        },
    )
    assert first.status_code == 200, first.text
    trusted_cookie = first.cookies.get(auth_api.settings.trusted_device_cookie_name)
    assert trusted_cookie

    second = client.post(
        "/auth/login",
        json={
            "email": "trusted-admin@example.com",
            "password": "TestPass123",
        },
        cookies={auth_api.settings.trusted_device_cookie_name: trusted_cookie},
    )
    assert second.status_code == 200, second.text


def test_backup_code_is_one_time_use(client: TestClient, db: Session):
    user = _make_user(db, email="backup-user@example.com", role=UserRole.staff)
    secret = generate_totp_secret()
    user.two_factor_secret = secret
    user.two_factor_enabled = True
    user.two_factor_enabled_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()

    login = _login(client, "backup-user@example.com", otp_code=generate_totp_code(secret))
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]

    regen = client.post("/auth/2fa/backup-codes/regenerate", headers=_auth(token))
    assert regen.status_code == 200, regen.text
    code = regen.json()["codes"][0]
    assert code

    first = client.post(
        "/auth/login",
        json={
            "email": "backup-user@example.com",
            "password": "TestPass123",
            "otp_code": code,
        },
    )
    assert first.status_code == 200, first.text

    second = client.post(
        "/auth/login",
        json={
            "email": "backup-user@example.com",
            "password": "TestPass123",
            "otp_code": code,
        },
    )
    assert second.status_code == 401


def test_super_admin_can_reset_user_2fa(client: TestClient, db: Session):
    super_admin = _make_user(db, email="admin@example.com", role=UserRole.admin)
    target = _make_user(db, email="target-user@example.com", role=UserRole.staff)
    old_secret = generate_totp_secret()
    target.two_factor_secret = old_secret
    target.two_factor_enabled = True
    target.two_factor_enabled_at = datetime.now(timezone.utc)
    db.add(target)
    db.commit()

    token = _login(client, super_admin.email).json()["access_token"]
    response = client.post(
        f"/security/users/{target.id}/2fa/reset",
        json={"reason": "lost authenticator"},
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text
    db.refresh(target)
    assert target.two_factor_enabled is False
    assert target.two_factor_secret
    assert target.two_factor_secret != old_secret


def test_non_super_admin_cannot_reset_user_2fa(client: TestClient, db: Session):
    normal_admin = _make_user(db, email="normal-admin-reset@example.com", role=UserRole.admin)
    target = _make_user(db, email="target-reset-denied@example.com", role=UserRole.staff)
    token = _login(client, normal_admin.email).json()["access_token"]

    response = client.post(
        f"/security/users/{target.id}/2fa/reset",
        json={"reason": "test"},
        headers=_auth(token),
    )
    assert response.status_code == 403

    audit = db.scalar(
        select(AuditLog)
        .where(AuditLog.action == "admin_force_2fa_reset_denied")
        .order_by(AuditLog.created_at.desc())
    )
    assert audit is not None
