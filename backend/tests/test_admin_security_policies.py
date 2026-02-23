"""Tests for admin-only security policy hardening."""


from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import auth as auth_api
from app.core.security import generate_totp_code, generate_totp_secret, get_password_hash
from app.models.audit_log import AuditLog
from app.models.device_registration import DeviceRegistration
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


def test_emergency_unlock_admin_requires_super_admin(
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
    detail = log.details if isinstance(log.details, dict) else __import__('json').loads(log.details)
    assert detail["success"] is False


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

    client.cookies.set(auth_api.settings.trusted_device_cookie_name, trusted_cookie)
    second = client.post(
        "/auth/login",
        json={
            "email": "trusted-admin@example.com",
            "password": "TestPass123",
        },
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


def test_super_admin_can_reset_user_password(client: TestClient, db: Session):
    super_admin = _make_user(db, email="admin@example.com", role=UserRole.admin)
    target = _make_user(db, email="target-password-reset@example.com", role=UserRole.staff, password="OldPass123")
    token = _login(client, super_admin.email).json()["access_token"]

    response = client.post(
        f"/security/users/{target.id}/password/reset",
        json={"reason": "Emergency account recovery for lost credentials"},
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["email"] == target.email
    assert payload["reset_token"]
    assert payload["reset_token_expires_in"] > 0

    reset = client.post(
        "/auth/reset-password",
        json={
            "token": payload["reset_token"],
            "new_password": "NewStrongPass456",
        },
    )
    assert reset.status_code == 200, reset.text

    relogin = _login(
        client,
        target.email,
        password="NewStrongPass456",
    )
    assert relogin.status_code == 200, relogin.text


def test_non_super_admin_cannot_reset_user_password(client: TestClient, db: Session):
    normal_admin = _make_user(db, email="normal-admin-password-reset@example.com", role=UserRole.admin)
    target = _make_user(db, email="target-password-reset-denied@example.com", role=UserRole.staff)
    token = _login(client, normal_admin.email).json()["access_token"]

    response = client.post(
        f"/security/users/{target.id}/password/reset",
        json={"reason": "Temporary reset request"},
        headers=_auth(token),
    )
    assert response.status_code == 403

    audit = db.scalar(
        select(AuditLog)
        .where(AuditLog.action == "admin_force_password_reset_denied")
        .order_by(AuditLog.created_at.desc())
    )
    assert audit is not None


def test_admin_can_resolve_user_for_emergency_toolkit(client: TestClient, db: Session):
    admin = _make_user(db, email="resolve-admin@example.com", role=UserRole.admin)
    target = _make_user(db, email="resolve-target@example.com", role=UserRole.staff)
    token = _login(client, admin.email).json()["access_token"]

    response = client.get(
        f"/security/users/resolve?email={target.email}",
        headers=_auth(token),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["user_id"] == str(target.id)
    assert payload["email"] == target.email


def test_admin_can_manage_device_registry(client: TestClient, db: Session):
    admin = _make_user(db, email="registry-admin@example.com", role=UserRole.admin)
    token = _login(client, admin.email).json()["access_token"]

    created = client.post(
        "/security/devices",
        json={
            "device_id": "ward-bp-001",
            "display_name": "Ward BP Device 01",
            "notes": "Near nursing station",
            "is_active": True,
        },
        headers=_auth(token),
    )
    assert created.status_code == 201, created.text
    created_payload = created.json()
    assert created_payload["device"]["device_id"] == "ward-bp-001"
    assert len(created_payload["device_secret"]) >= 32

    listed = client.get("/security/devices?page=1&limit=20", headers=_auth(token))
    assert listed.status_code == 200, listed.text
    listed_payload = listed.json()
    assert listed_payload["total"] >= 1
    assert any(item["device_id"] == "ward-bp-001" for item in listed_payload["items"])

    updated = client.patch(
        "/security/devices/ward-bp-001",
        json={"is_active": False, "notes": "Deactivated for maintenance"},
        headers=_auth(token),
    )
    assert updated.status_code == 200, updated.text
    updated_payload = updated.json()
    assert updated_payload["is_active"] is False
    assert updated_payload["deactivated_at"] is not None
    assert updated_payload["notes"] == "Deactivated for maintenance"

    rotated = client.post(
        "/security/devices/ward-bp-001/rotate-secret",
        json={},
        headers=_auth(token),
    )
    assert rotated.status_code == 200, rotated.text
    rotated_payload = rotated.json()
    assert len(rotated_payload["device_secret"]) >= 32

    row = db.scalar(select(DeviceRegistration).where(DeviceRegistration.device_id == "ward-bp-001"))
    assert row is not None
    assert row.device_secret == rotated_payload["device_secret"]


def test_non_admin_cannot_access_device_registry(client: TestClient, db: Session):
    staff = _make_user(db, email="registry-staff@example.com", role=UserRole.staff)
    token = _login(client, staff.email).json()["access_token"]
    response = client.get("/security/devices", headers=_auth(token))
    assert response.status_code == 403


def test_security_stats_tracks_403_spike_counter(client: TestClient, db: Session):
    admin = _make_user(db, email="metrics-admin@example.com", role=UserRole.admin)
    staff = _make_user(db, email="metrics-staff@example.com", role=UserRole.staff)
    admin_token = _login(client, admin.email).json()["access_token"]
    staff_token = _login(client, staff.email).json()["access_token"]

    blocked = client.get("/users", headers=_auth(staff_token))
    assert blocked.status_code == 403

    db.add(
        AuditLog(
            user_id=staff.id,
            action="http_403_denied",
            resource_type="http_request",
            details={"path": "/users", "status_code": 403},
            ip_address="127.0.0.1",
            is_break_glass=False,
        )
    )

    db.add(
        AuditLog(
            user_id=admin.id,
            action="user_purge_deleted_summary",
            resource_type="user",
            details={"purged": 2},
            ip_address="127.0.0.1",
            is_break_glass=False,
        )
    )
    db.add(
        AuditLog(
            user_id=admin.id,
            action="admin_force_password_reset",
            resource_type="user",
            details={"target_email": "incident@example.com"},
            ip_address="127.0.0.1",
            is_break_glass=False,
        )
    )
    db.commit()

    stats = client.get("/security/stats", headers=_auth(admin_token))
    assert stats.status_code == 200
    payload = stats.json()
    assert payload["forbidden_403_1h"] >= 1
    assert "failed_logins_1h" in payload
    assert payload["purge_actions_24h"] >= 1
    assert payload["emergency_actions_24h"] >= 1
