# ruff: noqa: E402
"""Tests for admin-only security policy hardening."""

import pytest

pytest.skip("Legacy admin 2FA policy tests no longer apply after 2FA removal.", allow_module_level=True)

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import auth as auth_api
from app.core.config import get_settings
from app.core.secret_crypto import SECRET_VALUE_PREFIX
from app.core.security import generate_totp_code, generate_totp_secret, get_password_hash
from app.models.audit_log import AuditLog
from app.models.device_registration import DeviceRegistration
from app.models.enums import PrivilegedRole, UserRole
from app.models.user_backup_code import UserBackupCode
from app.models.user import User
from app.models.user_privileged_role_assignment import UserPrivilegedRoleAssignment
from app.services import security as security_service
from app.services.auth import create_login_response


def _make_user(db: Session, *, email: str, role: UserRole = UserRole.medical_student, password: str = "TestPass123") -> User:
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


def _grant_privileged_role(
    db: Session,
    *,
    user: User,
    role: PrivilegedRole,
    created_by: User | None = None,
    reason: str = "privileged access granted for test coverage",
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


def test_admin_login_requires_2fa_code(client: TestClient, db: Session, monkeypatch):
    monkeypatch.setattr(auth_api.settings, "admin_2fa_required", True)
    admin = _make_user(db, email="twofa-admin@example.com", role=UserRole.admin)

    response = _login(client, "twofa-admin@example.com")
    assert response.status_code == 401
    detail = response.json()["detail"]
    assert detail["code"] == "two_factor_required"
    assert detail["setup_required"] is True
    assert "provisioning_uri" in detail

    audit = db.scalar(
        select(AuditLog)
        .where(AuditLog.action == "two_factor_challenge")
        .order_by(AuditLog.created_at.desc())
    )
    assert audit is not None
    assert audit.user_id == admin.id
    assert audit.status == "success"


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


def test_locked_admin_returns_generic_locked_response_even_with_correct_password(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    monkeypatch.setattr(auth_api.settings, "admin_2fa_required", True)
    admin = _make_user(db, email="locked-admin-stepup@example.com", role=UserRole.admin)
    admin.failed_login_attempts = 15
    admin.account_locked_until = datetime.now(timezone.utc) + timedelta(minutes=3)
    db.add(admin)
    db.commit()

    response = _login(client, "locked-admin-stepup@example.com")

    assert response.status_code == 423, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "account_locked"
    assert "contact_admin" in detail["recovery_options"]
    assert detail["retry_after_seconds"] > 0

    db.refresh(admin)
    assert admin.failed_login_attempts == 15
    assert admin.account_locked_until is not None


def test_locked_admin_returns_same_locked_response_for_wrong_password(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    monkeypatch.setattr(auth_api.settings, "admin_2fa_required", True)
    admin = _make_user(db, email="locked-admin-wrong-password@example.com", role=UserRole.admin)
    admin.failed_login_attempts = 15
    admin.account_locked_until = datetime.now(timezone.utc) + timedelta(minutes=3)
    db.add(admin)
    db.commit()

    correct = _login(client, "locked-admin-wrong-password@example.com")
    wrong = _login(client, "locked-admin-wrong-password@example.com", password="WrongPass123")

    assert correct.status_code == 423, correct.text
    assert wrong.status_code == 423, wrong.text
    assert correct.json()["detail"]["code"] == "account_locked"
    assert wrong.json()["detail"]["code"] == "account_locked"
    assert correct.json()["detail"]["recovery_options"] == wrong.json()["detail"]["recovery_options"]


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


def test_trusted_device_does_not_bypass_locked_admin_account(client: TestClient, db: Session, monkeypatch):
    monkeypatch.setattr(auth_api.settings, "admin_2fa_required", True)
    admin = _make_user(db, email="trusted-locked-admin@example.com", role=UserRole.admin)
    secret = generate_totp_secret()
    admin.two_factor_secret = secret
    admin.two_factor_enabled = True
    admin.two_factor_enabled_at = datetime.now(timezone.utc)
    db.add(admin)
    db.commit()

    first = client.post(
        "/auth/login",
        json={
            "email": "trusted-locked-admin@example.com",
            "password": "TestPass123",
            "otp_code": generate_totp_code(secret),
            "remember_device": True,
        },
    )
    assert first.status_code == 200, first.text
    trusted_cookie = first.cookies.get(auth_api.settings.trusted_device_cookie_name)
    assert trusted_cookie

    admin.failed_login_attempts = 15
    admin.account_locked_until = datetime.now(timezone.utc) + timedelta(minutes=3)
    db.add(admin)
    db.commit()

    client.cookies.set(auth_api.settings.trusted_device_cookie_name, trusted_cookie)
    second = _login(client, "trusted-locked-admin@example.com")
    assert second.status_code == 423, second.text
    assert second.json()["detail"]["code"] == "account_locked"

    db.refresh(admin)
    assert admin.failed_login_attempts == 15
    assert admin.account_locked_until is not None


def test_backup_code_is_one_time_use(client: TestClient, db: Session):
    user = _make_user(db, email="backup-user@example.com", role=UserRole.medical_student)
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

    audit = db.scalar(
        select(AuditLog)
        .where(AuditLog.action == "login_with_backup_code")
        .order_by(AuditLog.created_at.desc())
    )
    assert audit is not None
    assert audit.user_id == user.id
    assert audit.status == "success"

    second = client.post(
        "/auth/login",
        json={
            "email": "backup-user@example.com",
            "password": "TestPass123",
            "otp_code": code,
        },
    )
    assert second.status_code == 401


def test_locked_clinical_user_without_2fa_sees_recovery_options(client: TestClient, db: Session):
    user = _make_user(db, email="locked-doctor@example.com", role=UserRole.doctor)
    user.failed_login_attempts = 8
    user.account_locked_until = datetime.now(timezone.utc) + timedelta(minutes=2)
    db.add(user)
    db.commit()

    response = _login(client, "locked-doctor@example.com")

    assert response.status_code == 423, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "account_locked"
    assert "forgot_password" in detail["recovery_options"]
    assert "contact_admin" in detail["recovery_options"]

    db.refresh(user)
    assert user.failed_login_attempts == 8
    assert user.account_locked_until is not None


def test_locked_clinical_user_with_valid_2fa_code_still_receives_locked_response(client: TestClient, db: Session):
    secret = generate_totp_secret()
    user = _make_user(db, email="locked-student-2fa@example.com", role=UserRole.medical_student)
    user.two_factor_secret = secret
    user.two_factor_enabled = True
    user.two_factor_enabled_at = datetime.now(timezone.utc)
    user.failed_login_attempts = 8
    user.account_locked_until = datetime.now(timezone.utc) + timedelta(minutes=2)
    db.add(user)
    db.commit()

    response = _login(
        client,
        "locked-student-2fa@example.com",
        otp_code=generate_totp_code(secret),
    )

    assert response.status_code == 423, response.text
    assert response.json()["detail"]["code"] == "account_locked"
    db.refresh(user)
    assert user.failed_login_attempts == 8
    assert user.account_locked_until is not None


def test_locked_login_ignores_invalid_otp_and_keeps_existing_lock_state(client: TestClient, db: Session):
    secret = generate_totp_secret()
    user = _make_user(db, email="locked-invalid-otp@example.com", role=UserRole.medical_student)
    user.two_factor_secret = secret
    user.two_factor_enabled = True
    user.two_factor_enabled_at = datetime.now(timezone.utc)
    user.failed_login_attempts = 8
    original_locked_until = datetime.now(timezone.utc) + timedelta(minutes=2)
    user.account_locked_until = original_locked_until
    db.add(user)
    db.commit()

    response = _login(client, "locked-invalid-otp@example.com", otp_code="000000")

    assert response.status_code == 423
    assert response.json()["detail"]["code"] == "account_locked"
    db.refresh(user)
    assert user.failed_login_attempts == 8
    assert user.account_locked_until.replace(tzinfo=timezone.utc) == original_locked_until


def test_invalid_two_factor_code_writes_login_failure_audit(client: TestClient, db: Session, monkeypatch):
    monkeypatch.setattr(auth_api.settings, "admin_2fa_required", True)
    secret = generate_totp_secret()
    admin = _make_user(db, email="twofa-fail@example.com", role=UserRole.admin)
    admin.two_factor_secret = secret
    admin.two_factor_enabled = True
    admin.two_factor_enabled_at = datetime.now(timezone.utc)
    db.add(admin)
    db.commit()

    response = _login(client, "twofa-fail@example.com", otp_code="000000")

    assert response.status_code == 401

    audit = db.scalar(
        select(AuditLog)
        .where(AuditLog.action == "login_failed_2fa")
        .order_by(AuditLog.created_at.desc())
    )
    assert audit is not None
    assert audit.user_id == admin.id
    assert audit.status == "failure"


def test_remember_device_login_writes_trusted_device_creation_audit(client: TestClient, db: Session):
    secret = generate_totp_secret()
    user = _make_user(db, email="trusted-device-audit@example.com", role=UserRole.medical_student)
    user.two_factor_secret = secret
    user.two_factor_enabled = True
    user.two_factor_enabled_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()

    response = client.post(
        "/auth/login",
        json={
            "email": "trusted-device-audit@example.com",
            "password": "TestPass123",
            "otp_code": generate_totp_code(secret),
            "remember_device": True,
        },
    )

    assert response.status_code == 200, response.text

    audit = db.scalar(
        select(AuditLog)
        .where(AuditLog.action == "trusted_device_created")
        .order_by(AuditLog.created_at.desc())
    )
    assert audit is not None
    assert audit.user_id == user.id
    assert audit.status == "success"


def test_super_admin_can_reset_user_2fa(client: TestClient, db: Session):
    super_admin = _make_user(db, email="admin@example.com", role=UserRole.admin)
    target = _make_user(db, email="target-user@example.com", role=UserRole.medical_student)
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
    target = _make_user(db, email="target-reset-denied@example.com", role=UserRole.medical_student)
    token = _login(client, normal_admin.email).json()["access_token"]

    response = client.post(
        f"/security/users/{target.id}/2fa/reset",
        json={"reason": "This reset attempt should be denied"},
        headers=_auth(token),
    )
    assert response.status_code == 403

    audit = db.scalar(
        select(AuditLog)
        .where(AuditLog.action == "admin_force_2fa_reset_denied")
        .order_by(AuditLog.created_at.desc())
    )
    assert audit is not None


def test_security_admin_can_register_device_from_forwarded_ip(client: TestClient, db: Session, monkeypatch):
    from app.core import request_utils

    bootstrap_admin = _make_user(db, email="admin@example.com", role=UserRole.admin)
    security_admin = _make_user(db, email="registry-non-recovery-ip-admin@example.com", role=UserRole.admin)
    _grant_privileged_role(
        db,
        user=security_admin,
        role=PrivilegedRole.security_admin,
        created_by=bootstrap_admin,
    )

    monkeypatch.setattr(request_utils.settings, "trusted_proxy_ips", ["testclient"])
    token = _login(client, security_admin.email).json()["access_token"]
    response = client.post(
        "/security/devices",
        json={
            "device_id": "ward-device-non-recovery-ip-001",
            "display_name": "Ward Device Non Recovery IP",
            "notes": "Normal device registry action",
            "is_active": True,
        },
        headers={
            **_auth(token),
            "x-forwarded-for": "198.51.100.44",
        },
    )

    assert response.status_code == 201, response.text
    assert response.json()["device"]["device_id"] == "ward-device-non-recovery-ip-001"

    updated = client.patch(
        "/security/devices/ward-device-non-recovery-ip-001",
        json={"is_active": False},
        headers={
            **_auth(token),
            "x-forwarded-for": "198.51.100.44",
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["is_active"] is False

    deleted = client.delete(
        "/security/devices/ward-device-non-recovery-ip-001",
        headers={
            **_auth(token),
            "x-forwarded-for": "198.51.100.44",
        },
    )
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["device_id"] == "ward-device-non-recovery-ip-001"


def test_security_admin_can_manage_device_registry(client: TestClient, db: Session):
    bootstrap_admin = _make_user(db, email="admin@example.com", role=UserRole.admin)
    security_admin = _make_user(db, email="registry-security-admin@example.com", role=UserRole.admin)
    _grant_privileged_role(
        db,
        user=security_admin,
        role=PrivilegedRole.security_admin,
        created_by=bootstrap_admin,
    )
    token = _login(client, security_admin.email).json()["access_token"]

    created = client.post(
        "/security/devices",
        json={
            "device_id": "ward-bp-001",
            "display_name": "Ward BP Device 01",
            "notes": "Near nursing station",
            "default_measurement_type": "heart_sound",
            "is_active": True,
        },
        headers=_auth(token),
    )
    assert created.status_code == 201, created.text
    created_payload = created.json()
    assert created_payload["device"]["device_id"] == "ward-bp-001"
    assert created_payload["device"]["default_measurement_type"] == "heart_sound"
    assert len(created_payload["device_secret"]) >= 32
    assert "device_secret" not in created_payload["device"]

    listed = client.get("/security/devices?page=1&limit=20", headers=_auth(token))
    assert listed.status_code == 200, listed.text
    listed_payload = listed.json()
    assert listed_payload["total"] >= 1
    assert any(item["device_id"] == "ward-bp-001" for item in listed_payload["items"])
    assert all("device_secret" not in item for item in listed_payload["items"])

    updated = client.patch(
        "/security/devices/ward-bp-001",
        json={
            "is_active": False,
            "notes": "Deactivated for maintenance",
            "default_measurement_type": "blood_pressure",
        },
        headers=_auth(token),
    )
    assert updated.status_code == 200, updated.text
    updated_payload = updated.json()
    assert updated_payload["is_active"] is False
    assert updated_payload["deactivated_at"] is not None
    assert updated_payload["notes"] == "Deactivated for maintenance"
    assert updated_payload["default_measurement_type"] == "blood_pressure"
    assert "device_secret" not in updated_payload

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
    assert row._device_secret_encrypted.startswith(SECRET_VALUE_PREFIX)
    assert row._device_secret_encrypted != rotated_payload["device_secret"]

    device_audits = db.scalars(
        select(AuditLog)
        .where(AuditLog.action.in_(["device_registration_create", "device_registration_rotate_secret"]))
        .order_by(AuditLog.created_at.asc())
    ).all()
    assert device_audits
    for audit in device_audits:
        serialized_details = audit.details if isinstance(audit.details, str) else str(audit.details)
        assert rotated_payload["device_secret"] not in serialized_details
        assert created_payload["device_secret"] not in serialized_details

    deleted = client.delete(
        "/security/devices/ward-bp-001",
        headers=_auth(token),
    )
    assert deleted.status_code == 200, deleted.text
    deleted_payload = deleted.json()
    assert deleted_payload["device_id"] == "ward-bp-001"

    row_after_delete = db.scalar(select(DeviceRegistration).where(DeviceRegistration.device_id == "ward-bp-001"))
    assert row_after_delete is None


def test_security_device_registry_rejects_reserved_secret_prefix(client: TestClient, db: Session):
    bootstrap_admin = _make_user(db, email="admin@example.com", role=UserRole.admin)
    security_admin = _make_user(db, email="reserved-prefix-admin@example.com", role=UserRole.admin)
    _grant_privileged_role(
        db,
        user=security_admin,
        role=PrivilegedRole.security_admin,
        created_by=bootstrap_admin,
    )
    token = _login(client, security_admin.email).json()["access_token"]

    response = client.post(
        "/security/devices",
        json={
            "device_id": "ward-bp-reserved-prefix-001",
            "display_name": "Reserved Prefix Device",
            "device_secret": "encv1:this-looks-like-a-plaintext-secret-but-is-reserved-1234567890",
            "is_active": True,
        },
        headers=_auth(token),
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "device_secret cannot start with reserved prefix 'encv1:'."


def test_generic_admin_cannot_manage_device_credentials(client: TestClient, db: Session):
    admin = _make_user(db, email="registry-generic-admin@example.com", role=UserRole.admin)
    device = DeviceRegistration(
        device_id="ward-bp-denied-001",
        display_name="Denied Device",
        device_secret="denied_device_secret_1234567890abcdef1234567890",
        is_active=True,
    )
    db.add(device)
    db.commit()

    token = _login(client, admin.email).json()["access_token"]
    headers = _auth(token)

    create_response = client.post(
        "/security/devices",
        json={
            "device_id": "ward-bp-create-denied-001",
            "display_name": "Denied Create Device",
            "is_active": True,
        },
        headers=headers,
    )
    rotate_response = client.post(
        f"/security/devices/{device.device_id}/rotate-secret",
        json={},
        headers=headers,
    )
    update_response = client.patch(
        f"/security/devices/{device.device_id}",
        json={"is_active": False},
        headers=headers,
    )
    delete_response = client.delete(
        f"/security/devices/{device.device_id}",
        headers=headers,
    )

    assert create_response.status_code == 403
    assert rotate_response.status_code == 403
    assert update_response.status_code == 403
    assert delete_response.status_code == 403


def test_non_admin_cannot_access_device_registry(client: TestClient, db: Session):
    medical_student = _make_user(
        db,
        email="registry-medical-student@example.com",
        role=UserRole.medical_student,
    )
    token = _login(client, medical_student.email).json()["access_token"]
    response = client.get("/security/devices", headers=_auth(token))
    assert response.status_code == 403


def test_security_stats_tracks_403_spike_counter(client: TestClient, db: Session):
    admin = _make_user(db, email="metrics-admin@example.com", role=UserRole.admin)
    medical_student = _make_user(
        db,
        email="metrics-medical-student@example.com",
        role=UserRole.medical_student,
    )
    admin_token = _login(client, admin.email).json()["access_token"]
    medical_student_token = _login(client, medical_student.email).json()["access_token"]

    blocked = client.get("/users", headers=_auth(medical_student_token))
    assert blocked.status_code == 403

    db.add(
        AuditLog(
            user_id=medical_student.id,
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
    db.commit()

    stats = client.get("/security/stats", headers=_auth(admin_token))
    assert stats.status_code == 200
    payload = stats.json()
    assert payload["forbidden_403_1h"] >= 1
    assert "failed_logins_1h" in payload
    assert payload["purge_actions_24h"] >= 1
