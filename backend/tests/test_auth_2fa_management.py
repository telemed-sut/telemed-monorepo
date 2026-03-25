from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import auth as auth_api
from app.core.security import (
    generate_totp_code,
    generate_totp_secret,
    get_password_hash,
    hash_security_token,
)
from app.models.audit_log import AuditLog
from app.models.user import User
from app.models.user_backup_code import UserBackupCode
from app.models.user_trusted_device import UserTrustedDevice
from app.models.enums import UserRole
from app.services.auth import create_login_response


def _create_user(
    db: Session,
    *,
    email: str,
    role: UserRole = UserRole.medical_student,
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


def _auth_headers(user: User) -> dict[str, str]:
    token = create_login_response(user)["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _login(
    client: TestClient,
    *,
    email: str,
    password: str = "TestPass123",
    otp_code: str | None = None,
    remember_device: bool = False,
    user_agent: str = "pytest-agent",
):
    payload: dict[str, object] = {
        "email": email,
        "password": password,
        "remember_device": remember_device,
    }
    if otp_code:
        payload["otp_code"] = otp_code
    return client.post(
        "/auth/login",
        json=payload,
        headers={"user-agent": user_agent},
    )


def test_get_me_returns_current_user_profile(client: TestClient, db: Session):
    user = _create_user(db, email="me@example.com", role=UserRole.doctor)

    response = client.get("/auth/me", headers=_auth_headers(user))

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == str(user.id)
    assert payload["email"] == "me@example.com"
    assert payload["role"] == "doctor"
    assert payload["two_factor_enabled"] is False
    assert payload["is_super_admin"] is False


def test_get_me_marks_super_admin_accounts(client: TestClient, db: Session):
    user = _create_user(db, email="admin@example.com", role=UserRole.admin)

    response = client.get("/auth/me", headers=_auth_headers(user))

    assert response.status_code == 200
    payload = response.json()
    assert payload["email"] == "admin@example.com"
    assert payload["is_super_admin"] is True


def test_get_two_factor_status_provisions_secret(client: TestClient, db: Session):
    user = _create_user(db, email="status@example.com", role=UserRole.medical_student)

    response = client.get("/auth/2fa/status", headers=_auth_headers(user))

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["role"] == "medical_student"
    assert payload["required"] is False
    assert payload["enabled"] is False
    assert payload["setup_required"] is True
    assert payload["account_email"] == "status@example.com"
    assert payload["provisioning_uri"]

    db.refresh(user)
    assert user.two_factor_secret is not None


def test_verify_two_factor_enables_user_two_factor(
    client: TestClient,
    db: Session,
):
    user = _create_user(db, email="verify-2fa@example.com", role=UserRole.medical_student)
    status_response = client.get("/auth/2fa/status", headers=_auth_headers(user))
    assert status_response.status_code == 200

    db.refresh(user)
    otp_code = generate_totp_code(user.two_factor_secret)
    response = client.post(
        "/auth/2fa/verify",
        json={"otp_code": otp_code},
        headers=_auth_headers(user),
    )

    assert response.status_code == 200, response.text
    assert "verified successfully" in response.json()["message"].lower()
    db.refresh(user)
    assert user.two_factor_enabled is True
    assert user.two_factor_enabled_at is not None


def test_verify_two_factor_invalid_code_writes_failure_audit(
    client: TestClient,
    db: Session,
):
    user = _create_user(db, email="verify-2fa-fail@example.com", role=UserRole.medical_student)
    status_response = client.get("/auth/2fa/status", headers=_auth_headers(user))
    assert status_response.status_code == 200

    response = client.post(
        "/auth/2fa/verify",
        json={"otp_code": "000000"},
        headers=_auth_headers(user),
    )

    assert response.status_code == 400
    audit = db.scalar(
        select(AuditLog).where(
            AuditLog.action == "two_factor_verify_failed",
            AuditLog.user_id == user.id,
        )
    )
    assert audit is not None
    assert audit.status == "failure"


def test_disable_two_factor_clears_secret_for_non_admin_user(
    client: TestClient,
    db: Session,
):
    secret = generate_totp_secret()
    user = _create_user(db, email="disable-2fa@example.com", role=UserRole.medical_student)
    user.two_factor_secret = secret
    user.two_factor_enabled = True
    user.two_factor_enabled_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()

    response = client.post(
        "/auth/2fa/disable",
        json={"current_otp_code": generate_totp_code(secret)},
        headers=_auth_headers(user),
    )

    assert response.status_code == 200, response.text
    assert response.json()["message"] == "Two-factor authentication disabled."
    db.refresh(user)
    assert user.two_factor_enabled is False
    assert user.two_factor_enabled_at is None
    assert user.two_factor_secret is None


def test_disable_two_factor_invalid_code_writes_failure_audit(
    client: TestClient,
    db: Session,
):
    secret = generate_totp_secret()
    user = _create_user(db, email="disable-2fa-fail@example.com", role=UserRole.medical_student)
    user.two_factor_secret = secret
    user.two_factor_enabled = True
    user.two_factor_enabled_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()

    response = client.post(
        "/auth/2fa/disable",
        json={"current_otp_code": "000000"},
        headers=_auth_headers(user),
    )

    assert response.status_code == 400
    audit = db.scalar(
        select(AuditLog).where(
            AuditLog.action == "two_factor_disable_denied",
            AuditLog.user_id == user.id,
        )
    )
    assert audit is not None
    assert audit.status == "failure"


def test_reset_two_factor_rotates_secret_and_revokes_backup_codes(
    client: TestClient,
    db: Session,
):
    secret = generate_totp_secret()
    user = _create_user(db, email="reset-2fa@example.com", role=UserRole.medical_student)
    user.two_factor_secret = secret
    user.two_factor_enabled = True
    user.two_factor_enabled_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()

    auth_headers = _auth_headers(user)
    backup_response = client.post(
        "/auth/2fa/backup-codes/regenerate",
        headers=auth_headers,
    )
    assert backup_response.status_code == 200, backup_response.text

    response = client.post(
        "/auth/2fa/reset",
        json={
            "current_otp_code": generate_totp_code(secret),
            "reason": "Rotate authenticator",
        },
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["enabled"] is False
    assert payload["setup_required"] is True
    assert payload["provisioning_uri"]

    db.refresh(user)
    assert user.two_factor_secret is not None
    assert user.two_factor_secret != secret
    backup_codes = db.scalars(
        select(UserBackupCode).where(UserBackupCode.user_id == user.id)
    ).all()
    assert backup_codes
    assert all(code.used_at is not None for code in backup_codes)


def test_reset_two_factor_invalid_code_writes_failure_audit(
    client: TestClient,
    db: Session,
):
    secret = generate_totp_secret()
    user = _create_user(db, email="reset-2fa-fail@example.com", role=UserRole.medical_student)
    user.two_factor_secret = secret
    user.two_factor_enabled = True
    user.two_factor_enabled_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()

    response = client.post(
        "/auth/2fa/reset",
        json={"current_otp_code": "000000", "reason": "Rotate authenticator"},
        headers=_auth_headers(user),
    )

    assert response.status_code == 400
    audit = db.scalar(
        select(AuditLog).where(
            AuditLog.action == "two_factor_reset_denied",
            AuditLog.user_id == user.id,
        )
    )
    assert audit is not None
    assert audit.status == "failure"


def test_list_and_revoke_trusted_device(
    client: TestClient,
    db: Session,
):
    secret = generate_totp_secret()
    user = _create_user(db, email="trusted-device@example.com", role=UserRole.medical_student)
    user.two_factor_secret = secret
    user.two_factor_enabled = True
    user.two_factor_enabled_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()

    login_response = _login(
        client,
        email="trusted-device@example.com",
        otp_code=generate_totp_code(secret),
        remember_device=True,
    )
    assert login_response.status_code == 200, login_response.text
    access_token = login_response.json()["access_token"]

    list_response = client.get(
        "/auth/2fa/trusted-devices",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert list_response.status_code == 200, list_response.text
    payload = list_response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["current_device"] is True

    device_id = UUID(payload["items"][0]["id"])
    revoke_response = client.delete(
        f"/auth/2fa/trusted-devices/{device_id}",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert revoke_response.status_code == 200, revoke_response.text
    assert "revoked" in revoke_response.json()["message"].lower()

    device = db.scalar(select(UserTrustedDevice).where(UserTrustedDevice.id == device_id))
    assert device is not None
    assert device.revoked_at is not None


def test_revoke_all_trusted_devices_returns_revoked_count(
    client: TestClient,
    db: Session,
):
    user = _create_user(db, email="revoke-all@example.com", role=UserRole.medical_student)
    now = datetime.now(timezone.utc)
    db.add_all(
        [
            UserTrustedDevice(
                user_id=user.id,
                token_hash=hash_security_token("trusted-token-1"),
                ip_address="127.0.0.1",
                expires_at=now + timedelta(days=30),
            ),
            UserTrustedDevice(
                user_id=user.id,
                token_hash=hash_security_token("trusted-token-2"),
                ip_address="127.0.0.2",
                expires_at=now + timedelta(days=30),
            ),
        ]
    )
    db.commit()

    response = client.post(
        "/auth/2fa/trusted-devices/revoke-all",
        headers=_auth_headers(user),
    )

    assert response.status_code == 200, response.text
    assert response.json()["revoked"] == 2
    devices = db.scalars(
        select(UserTrustedDevice).where(UserTrustedDevice.user_id == user.id)
    ).all()
    assert devices
    assert all(device.revoked_at is not None for device in devices)


def test_use_backup_code_invalid_writes_failure_audit(
    client: TestClient,
    db: Session,
):
    secret = generate_totp_secret()
    user = _create_user(db, email="backup-code-fail@example.com", role=UserRole.medical_student)
    user.two_factor_secret = secret
    user.two_factor_enabled = True
    user.two_factor_enabled_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()

    response = client.post(
        "/auth/2fa/backup-codes/use",
        json={"code": "NOT-VALID"},
        headers=_auth_headers(user),
    )

    assert response.status_code == 400
    audit = db.scalar(
        select(AuditLog).where(
            AuditLog.action == "two_factor_backup_code_use_denied",
            AuditLog.user_id == user.id,
        )
    )
    assert audit is not None
    assert audit.status == "failure"


def test_get_admin_two_factor_status_for_admin_when_required(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    monkeypatch.setattr(auth_api.settings, "admin_2fa_required", True)
    admin = _create_user(db, email="admin-2fa-status@example.com", role=UserRole.admin)

    response = client.get("/auth/2fa/admin", headers=_auth_headers(admin))

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["required"] is True
    assert payload["enabled"] is False
    assert payload["setup_required"] is True
    assert payload["account_email"] == "admin-2fa-status@example.com"
    assert payload["provisioning_uri"]


def test_admin_verify_and_reset_two_factor_endpoints(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    monkeypatch.setattr(auth_api.settings, "admin_2fa_required", True)
    admin = _create_user(db, email="admin-2fa-verify@example.com", role=UserRole.admin)
    auth_headers = _auth_headers(admin)

    status_response = client.get("/auth/2fa/admin", headers=auth_headers)
    assert status_response.status_code == 200
    db.refresh(admin)
    original_secret = admin.two_factor_secret

    verify_response = client.post(
        "/auth/2fa/admin/verify",
        json={"otp_code": generate_totp_code(original_secret)},
        headers=auth_headers,
    )
    assert verify_response.status_code == 200, verify_response.text
    db.refresh(admin)
    assert admin.two_factor_enabled is True

    reset_response = client.post(
        "/auth/2fa/admin/reset",
        json={
            "current_otp_code": generate_totp_code(original_secret),
            "reason": "Rotate admin authenticator",
        },
        headers=auth_headers,
    )
    assert reset_response.status_code == 200, reset_response.text
    payload = reset_response.json()
    assert payload["required"] is True
    assert payload["enabled"] is False
    assert payload["setup_required"] is True
    assert payload["provisioning_uri"]

    db.refresh(admin)
    assert admin.two_factor_secret is not None
    assert admin.two_factor_secret != original_secret
    assert admin.two_factor_enabled is False
