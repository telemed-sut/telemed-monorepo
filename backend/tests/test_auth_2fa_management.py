from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import auth as auth_api
from app.core.security import (
    decode_token,
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
    assert "is_super_admin" not in payload


def test_access_profile_marks_bootstrap_super_admin_accounts(client: TestClient, db: Session):
    user = _create_user(db, email="admin@example.com", role=UserRole.admin)

    response = client.get("/auth/access-profile", headers=_auth_headers(user))

    assert response.status_code == 200
    payload = response.json()
    assert payload["has_privileged_access"] is True
    assert payload["access_class"] == "Vault Apex"
    assert payload["access_class_revealed"] is True


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


def test_step_up_auth_refreshes_current_session_for_local_user(client: TestClient, db: Session):
    secret = generate_totp_secret()
    user = _create_user(db, email="step-up@example.com", role=UserRole.medical_student)
    user.two_factor_secret = secret
    user.two_factor_enabled = True
    user.two_factor_enabled_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()

    stale_authenticated_at = datetime.now(timezone.utc) - timedelta(hours=1)
    stale_token = create_login_response(
        user,
        db=db,
        mfa_verified=True,
        mfa_authenticated_at=stale_authenticated_at,
        session_id="session-step-up",
    )["access_token"]

    response = client.post(
        "/auth/step-up",
        json={
            "password": "TestPass123",
            "otp_code": generate_totp_code(secret),
        },
        headers={"Authorization": f"Bearer {stale_token}"},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["user"]["email"] == "step-up@example.com"
    assert payload["user"]["mfa_recent_for_privileged_actions"] is True
    assert payload["user"]["mfa_authenticated_at"] is not None

    old_session = decode_token(stale_token)["session_id"]
    new_token = payload["access_token"]
    assert decode_token(new_token)["session_id"] == old_session
    assert decode_token(new_token)["mfa_authenticated_at"] > decode_token(stale_token)["mfa_authenticated_at"]

    audit = db.scalar(
        select(AuditLog).where(
            AuditLog.action == "step_up_verified",
            AuditLog.user_id == user.id,
        )
    )
    assert audit is not None
    assert audit.status == "success"


def test_step_up_auth_requires_two_factor_challenge_when_needed(client: TestClient, db: Session):
    user = _create_user(db, email="step-up-challenge@example.com", role=UserRole.admin)
    user.two_factor_secret = generate_totp_secret()
    user.two_factor_enabled = True
    user.two_factor_enabled_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()
    client.cookies.clear()
    stale_token = create_login_response(
        user,
        db=db,
        mfa_verified=True,
        mfa_authenticated_at=datetime.now(timezone.utc) - timedelta(hours=1),
    )["access_token"]

    response = client.post(
        "/auth/step-up",
        json={"password": "TestPass123"},
        headers={"Authorization": f"Bearer {stale_token}"},
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "two_factor_required"


def test_step_up_auth_rejects_invalid_password_and_writes_failure_audit(client: TestClient, db: Session):
    user = _create_user(db, email="step-up-invalid-password@example.com", role=UserRole.doctor)
    stale_token = create_login_response(
        user,
        db=db,
        mfa_verified=True,
        mfa_authenticated_at=datetime.now(timezone.utc) - timedelta(hours=1),
    )["access_token"]

    response = client.post(
        "/auth/step-up",
        json={"password": "WrongPass123"},
        headers={"Authorization": f"Bearer {stale_token}"},
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "invalid_credentials"

    audit = db.scalar(
        select(AuditLog).where(
            AuditLog.action == "step_up_failed",
            AuditLog.user_id == user.id,
        )
    )
    assert audit is not None
    assert audit.details["reason"] == "invalid_password"


def test_step_up_auth_rejects_invalid_two_factor_code_and_writes_failure_audit(client: TestClient, db: Session):
    secret = generate_totp_secret()
    user = _create_user(db, email="step-up-invalid-otp@example.com", role=UserRole.admin)
    user.two_factor_secret = secret
    user.two_factor_enabled = True
    user.two_factor_enabled_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()

    stale_token = create_login_response(
        user,
        db=db,
        mfa_verified=True,
        mfa_authenticated_at=datetime.now(timezone.utc) - timedelta(hours=1),
    )["access_token"]

    response = client.post(
        "/auth/step-up",
        json={"password": "TestPass123", "otp_code": "000000"},
        headers={"Authorization": f"Bearer {stale_token}"},
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "invalid_two_factor_code"

    audit = db.scalar(
        select(AuditLog).where(
            AuditLog.action == "step_up_failed",
            AuditLog.user_id == user.id,
        )
    )
    assert audit is not None
    assert audit.details["reason"] == "invalid_two_factor_code"


def test_step_up_auth_rejects_sso_sessions(client: TestClient, db: Session):
    user = _create_user(db, email="step-up-sso@example.com", role=UserRole.admin)
    sso_token = create_login_response(
        user,
        db=db,
        auth_source="sso",
        sso_provider="okta",
        session_id="sso-session",
    )["access_token"]

    response = client.post(
        "/auth/step-up",
        json={"password": "TestPass123"},
        headers={"Authorization": f"Bearer {sso_token}"},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "step_up_not_supported_for_sso"


def test_step_up_auth_can_create_trusted_device(client: TestClient, db: Session):
    secret = generate_totp_secret()
    user = _create_user(db, email="step-up-trusted@example.com", role=UserRole.admin)
    user.two_factor_secret = secret
    user.two_factor_enabled = True
    user.two_factor_enabled_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()

    stale_token = create_login_response(
        user,
        db=db,
        mfa_verified=True,
        mfa_authenticated_at=datetime.now(timezone.utc) - timedelta(hours=1),
    )["access_token"]

    response = client.post(
        "/auth/step-up",
        json={
            "password": "TestPass123",
            "otp_code": generate_totp_code(secret),
            "remember_device": True,
        },
        headers={"Authorization": f"Bearer {stale_token}", "user-agent": "pytest-step-up-device"},
    )

    assert response.status_code == 200, response.text
    trusted_devices = db.scalars(
        select(UserTrustedDevice).where(UserTrustedDevice.user_id == user.id)
    ).all()
    assert trusted_devices
    assert auth_api.settings.trusted_device_cookie_name in response.headers.get("set-cookie", "")


def test_step_up_auth_trusted_device_satisfies_follow_up_challenge(client: TestClient, db: Session):
    secret = generate_totp_secret()
    user = _create_user(db, email="step-up-follow-up@example.com", role=UserRole.admin)
    user.two_factor_secret = secret
    user.two_factor_enabled = True
    user.two_factor_enabled_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()

    first_token = create_login_response(
        user,
        db=db,
        mfa_verified=True,
        mfa_authenticated_at=datetime.now(timezone.utc) - timedelta(hours=5),
        session_id="step-up-follow-up-session",
    )["access_token"]

    first_response = client.post(
        "/auth/step-up",
        json={
            "password": "TestPass123",
            "otp_code": generate_totp_code(secret),
            "remember_device": True,
        },
        headers={"Authorization": f"Bearer {first_token}", "user-agent": "pytest-step-up-follow-up"},
    )

    assert first_response.status_code == 200, first_response.text
    trusted_cookie = first_response.cookies.get(auth_api.settings.trusted_device_cookie_name)
    assert trusted_cookie

    client.cookies.set(auth_api.settings.trusted_device_cookie_name, trusted_cookie)

    second_token = create_login_response(
        user,
        db=db,
        mfa_verified=True,
        mfa_authenticated_at=datetime.now(timezone.utc) - timedelta(hours=5),
        session_id="step-up-follow-up-session-2",
    )["access_token"]

    second_response = client.post(
        "/auth/step-up",
        json={"password": "TestPass123"},
        headers={"Authorization": f"Bearer {second_token}", "user-agent": "pytest-step-up-follow-up"},
    )

    assert second_response.status_code == 200, second_response.text
    assert second_response.json()["user"]["mfa_recent_for_privileged_actions"] is True


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

    audit = db.scalar(
        select(AuditLog)
        .where(AuditLog.action == "trusted_device_revoked")
        .order_by(AuditLog.created_at.desc())
    )
    assert audit is not None
    assert audit.user_id == user.id
    assert audit.status == "success"


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

    audit = db.scalar(
        select(AuditLog)
        .where(AuditLog.action == "trusted_devices_revoked_all")
        .order_by(AuditLog.created_at.desc())
    )
    assert audit is not None
    assert audit.user_id == user.id
    assert audit.status == "success"


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
