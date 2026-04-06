from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import auth as auth_api
from app.core.security import decode_token, generate_totp_code, generate_totp_secret
from app.models.audit_log import AuditLog
from app.models.invite import UserInvite
from app.models.patient import Patient
from app.models.user import User, UserRole
from app.core.security import get_password_hash
from app.services import auth as auth_service


def test_login_endpoint(client: TestClient, db: Session):
    """Test login endpoint"""
    # Create test user
    user = User(
        email="test@example.com",
        password_hash=get_password_hash("TestPassword123"),
        role=UserRole.medical_student
    )
    db.add(user)
    db.commit()
    
    # Test successful login
    response = client.post("/auth/login", json={
        "email": "test@example.com",
        "password": "TestPassword123"
    })
    
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert "expires_in" in data
    assert data["expires_in"] == auth_api.settings.jwt_expires_in
    assert data["user"]["email"] == "test@example.com"
    assert data["user"]["role"] == "medical_student"
    assert data["user"]["mfa_verified"] is True
    assert "set-cookie" in response.headers
    assert f"Max-Age={auth_api.settings.jwt_expires_in}" in response.headers["set-cookie"]

    audit = db.scalar(
        select(AuditLog).where(
            AuditLog.action == "login_success",
            AuditLog.user_id == user.id,
        )
    )
    assert audit is not None
    assert audit.status == "success"


def test_admin_login_uses_extended_session_ttl(client: TestClient, db: Session):
    user = User(
        email="admin-session@example.com",
        password_hash=get_password_hash("TestPassword123"),
        role=UserRole.admin,
    )
    db.add(user)
    db.commit()

    response = client.post("/auth/login", json={
        "email": "admin-session@example.com",
        "password": "TestPassword123",
    })

    assert response.status_code == 200
    data = response.json()
    assert data["expires_in"] == auth_api.settings.admin_jwt_expires_in
    assert f"Max-Age={auth_api.settings.admin_jwt_expires_in}" in response.headers["set-cookie"]


def test_login_invalid_credentials(client: TestClient, db: Session):
    """Test login with invalid credentials"""
    response = client.post("/auth/login", json={
        "email": "nonexistent@example.com",
        "password": "wrongpassword"
    })
    
    assert response.status_code == 401
    assert "Invalid email or password" in response.json()["detail"]


def test_refresh_endpoint(client: TestClient, db: Session):
    """Test refresh token endpoint"""
    # Create user and login
    user = User(
        email="refresh@example.com",
        password_hash=get_password_hash("TestPassword123"),
        role=UserRole.admin
    )
    db.add(user)
    db.commit()
    
    # Login first
    login_response = client.post("/auth/login", json={
        "email": "refresh@example.com",
        "password": "TestPassword123"
    })
    token = login_response.json()["access_token"]
    
    # Test refresh
    headers = {"Authorization": f"Bearer {token}"}
    response = client.post("/auth/refresh", headers=headers)
    
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["expires_in"] == auth_api.settings.admin_jwt_expires_in
    assert data["user"]["email"] == "refresh@example.com"
    assert f"Max-Age={auth_api.settings.admin_jwt_expires_in}" in response.headers["set-cookie"]


def test_refresh_endpoint_preserves_recent_mfa_and_session_metadata(client: TestClient, db: Session):
    user = User(
        email="refresh-mfa@example.com",
        password_hash=get_password_hash("TestPassword123"),
        role=UserRole.admin,
        two_factor_enabled=True,
    )
    db.add(user)
    db.commit()

    authenticated_at = datetime.now(timezone.utc) - timedelta(hours=3)
    stale_token = auth_service.create_login_response(
        user,
        db=db,
        mfa_verified=True,
        mfa_authenticated_at=authenticated_at,
        session_id="refresh-session-id",
    )["access_token"]

    response = client.post(
        "/auth/refresh",
        headers={"Authorization": f"Bearer {stale_token}"},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    refreshed_token = payload["access_token"]
    assert payload["user"]["mfa_recent_for_privileged_actions"] is True
    assert decode_token(refreshed_token)["session_id"] == "refresh-session-id"
    assert decode_token(refreshed_token)["mfa_authenticated_at"] == decode_token(stale_token)["mfa_authenticated_at"]


def test_refresh_endpoint_uses_auth_cookie(client: TestClient, db: Session):
    user = User(
        email="refresh-cookie@example.com",
        password_hash=get_password_hash("TestPassword123"),
        role=UserRole.admin,
    )
    db.add(user)
    db.commit()

    login_response = client.post("/auth/login", json={
        "email": "refresh-cookie@example.com",
        "password": "TestPassword123",
    })
    assert login_response.status_code == 200

    # No Authorization header; relies on cookie set by /auth/login
    response = client.post("/auth/refresh", headers={"origin": str(client.base_url).rstrip("/")})
    assert response.status_code == 200
    assert "access_token" in response.json()
    assert response.json()["user"]["email"] == "refresh-cookie@example.com"
    assert "csrf_token" in response.cookies


def test_refresh_endpoint_allows_same_origin_cookie_csrf(client: TestClient, db: Session):
    user = User(
        email="refresh-same-origin@example.com",
        password_hash=get_password_hash("TestPassword123"),
        role=UserRole.admin,
    )
    db.add(user)
    db.commit()

    login_response = client.post("/auth/login", json={
        "email": "refresh-same-origin@example.com",
        "password": "TestPassword123",
    })
    assert login_response.status_code == 200

    response = client.post("/auth/refresh", headers={"origin": str(client.base_url).rstrip("/")})
    assert response.status_code == 200
    assert response.json()["user"]["email"] == "refresh-same-origin@example.com"


def test_refresh_endpoint_rejects_cross_origin_cookie_csrf(client: TestClient, db: Session):
    user = User(
        email="refresh-cross-origin@example.com",
        password_hash=get_password_hash("TestPassword123"),
        role=UserRole.admin,
    )
    db.add(user)
    db.commit()

    login_response = client.post("/auth/login", json={
        "email": "refresh-cross-origin@example.com",
        "password": "TestPassword123",
    })
    assert login_response.status_code == 200

    response = client.post("/auth/refresh", headers={"origin": "https://evil.example.com"})
    assert response.status_code == 403
    assert response.json()["detail"] == "CSRF validation failed."


def test_refresh_endpoint_rejects_cookie_csrf_when_origin_and_referer_are_missing(client: TestClient, db: Session):
    user = User(
        email="refresh-missing-origin@example.com",
        password_hash=get_password_hash("TestPassword123"),
        role=UserRole.admin,
    )
    db.add(user)
    db.commit()

    login_response = client.post("/auth/login", json={
        "email": "refresh-missing-origin@example.com",
        "password": "TestPassword123",
    })
    assert login_response.status_code == 200

    response = client.post("/auth/refresh")
    assert response.status_code == 403
    assert response.json()["detail"] == "CSRF validation failed."


def test_refresh_endpoint_allows_csrf_header_fallback_when_origin_and_referer_are_missing(client: TestClient, db: Session):
    user = User(
        email="refresh-csrf-header@example.com",
        password_hash=get_password_hash("TestPassword123"),
        role=UserRole.admin,
    )
    db.add(user)
    db.commit()

    login_response = client.post("/auth/login", json={
        "email": "refresh-csrf-header@example.com",
        "password": "TestPassword123",
    })
    assert login_response.status_code == 200

    csrf_token = client.cookies.get("csrf_token")
    assert csrf_token

    response = client.post("/auth/refresh", headers={"x-csrf-token": csrf_token})
    assert response.status_code == 200
    assert response.json()["user"]["email"] == "refresh-csrf-header@example.com"


def test_logout_endpoint(client: TestClient, db: Session):
    """Test logout endpoint"""
    # Create user and login
    user = User(
        email="logout@example.com",
        password_hash=get_password_hash("TestPassword123"),
        role=UserRole.medical_student
    )
    db.add(user)
    db.commit()
    
    # Login first
    login_response = client.post("/auth/login", json={
        "email": "logout@example.com",
        "password": "TestPassword123"
    })
    token = login_response.json()["access_token"]
    
    # Test logout
    headers = {"Authorization": f"Bearer {token}"}
    response = client.post("/auth/logout", headers=headers)
    
    assert response.status_code == 200
    assert response.json()["message"] == "Successfully logged out"


def test_protected_endpoint_without_token(client: TestClient):
    """Test that protected endpoints require authentication"""
    response = client.post("/auth/refresh")
    assert response.status_code == 401
    
    response = client.post("/auth/logout")
    assert response.status_code == 200


def test_forgot_password_endpoint(client: TestClient, db: Session):
    """Forgot password should return a generic success response"""
    user = User(
        email="forgot@example.com",
        password_hash=get_password_hash("TestPassword123"),
        role=UserRole.medical_student
    )
    db.add(user)
    db.commit()

    response = client.post("/auth/forgot-password", json={"email": "forgot@example.com"})
    assert response.status_code == 200
    assert "message" in response.json()

    audit = db.scalar(
        select(AuditLog).where(
            AuditLog.action == "password_reset_requested",
            AuditLog.user_id == user.id,
        )
    )
    assert audit is not None
    assert audit.status == "success"


def test_forgot_password_unknown_email_writes_failure_audit(client: TestClient, db: Session):
    response = client.post("/auth/forgot-password", json={"email": "missing@example.com"})

    assert response.status_code == 200
    audit = db.scalar(
        select(AuditLog).where(AuditLog.action == "password_reset_requested")
    )
    assert audit is not None
    assert audit.status == "failure"
    assert audit.user_id is None


def test_reset_password_with_valid_token(client: TestClient, db: Session, monkeypatch):
    """Reset password should update stored password hash when token is valid"""
    user = User(
        email="reset@example.com",
        password_hash=get_password_hash("OldPassword123"),
        role=UserRole.medical_student
    )
    db.add(user)
    db.commit()

    monkeypatch.setenv("PASSWORD_RESET_RETURN_TOKEN_IN_RESPONSE", "true")
    from app.core.config import get_settings
    get_settings.cache_clear()

    forgot_response = client.post(
        "/auth/forgot-password",
        json={"email": "reset@example.com"},
        headers={"host": "localhost"},
    )
    reset_token = forgot_response.json().get("reset_token")
    assert reset_token

    reset_response = client.post(
        "/auth/reset-password",
        json={"token": reset_token, "new_password": "NewPassword123"},
    )
    assert reset_response.status_code == 200

    audit = db.scalar(
        select(AuditLog).where(
            AuditLog.action == "password_reset_completed",
            AuditLog.user_id == user.id,
        )
    )
    assert audit is not None
    assert audit.status == "success"

    login_response = client.post("/auth/login", json={"email": "reset@example.com", "password": "NewPassword123"})
    assert login_response.status_code == 200
    get_settings.cache_clear()


def test_reset_password_invalidates_existing_access_token(client: TestClient, db: Session, monkeypatch):
    user = User(
        email="reset-invalidate@example.com",
        password_hash=get_password_hash("OldPassword123"),
        role=UserRole.medical_student,
    )
    db.add(user)
    db.commit()

    login_response = client.post("/auth/login", json={"email": "reset-invalidate@example.com", "password": "OldPassword123"})
    assert login_response.status_code == 200
    old_token = login_response.json()["access_token"]

    monkeypatch.setenv("PASSWORD_RESET_RETURN_TOKEN_IN_RESPONSE", "true")
    from app.core.config import get_settings
    get_settings.cache_clear()

    forgot_response = client.post(
        "/auth/forgot-password",
        json={"email": "reset-invalidate@example.com"},
        headers={"host": "localhost"},
    )
    reset_token = forgot_response.json().get("reset_token")
    assert reset_token

    reset_response = client.post(
        "/auth/reset-password",
        json={"token": reset_token, "new_password": "NewPassword123"},
    )
    assert reset_response.status_code == 200

    stale_token_response = client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {old_token}"},
    )
    assert stale_token_response.status_code == 401

    get_settings.cache_clear()


def test_reset_password_token_cannot_be_reused(client: TestClient, db: Session, monkeypatch):
    user = User(
        email="reset-reuse@example.com",
        password_hash=get_password_hash("OldPassword123"),
        role=UserRole.medical_student,
    )
    db.add(user)
    db.commit()

    monkeypatch.setenv("PASSWORD_RESET_RETURN_TOKEN_IN_RESPONSE", "true")
    from app.core.config import get_settings
    get_settings.cache_clear()

    forgot_response = client.post(
        "/auth/forgot-password",
        json={"email": "reset-reuse@example.com"},
        headers={"host": "localhost"},
    )
    reset_token = forgot_response.json().get("reset_token")
    assert reset_token

    first_reset = client.post(
        "/auth/reset-password",
        json={"token": reset_token, "new_password": "NewPassword123"},
    )
    assert first_reset.status_code == 200

    second_reset = client.post(
        "/auth/reset-password",
        json={"token": reset_token, "new_password": "AnotherPassword123"},
    )
    assert second_reset.status_code == 400
    assert second_reset.json()["detail"] == "Invalid reset token"

    stale_audit = db.scalar(
        select(AuditLog)
        .where(AuditLog.action == "password_reset_denied")
        .order_by(AuditLog.created_at.desc())
    )
    assert stale_audit is not None
    details = stale_audit.details if isinstance(stale_audit.details, dict) else {}
    assert details.get("reason") == "stale_reset_token"

    get_settings.cache_clear()


def test_password_reset_token_cannot_be_used_as_access_token(client: TestClient, db: Session, monkeypatch):
    user = User(
        email="reset-token-access@example.com",
        password_hash=get_password_hash("Password123"),
        role=UserRole.medical_student,
    )
    db.add(user)
    db.commit()

    monkeypatch.setenv("PASSWORD_RESET_RETURN_TOKEN_IN_RESPONSE", "true")
    from app.core.config import get_settings
    get_settings.cache_clear()

    forgot_response = client.post(
        "/auth/forgot-password",
        json={"email": "reset-token-access@example.com"},
        headers={"host": "localhost"},
    )
    reset_token = forgot_response.json().get("reset_token")
    assert reset_token

    response = client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {reset_token}"},
    )
    assert response.status_code == 401

    get_settings.cache_clear()


def test_reset_password_with_invalid_token(client: TestClient):
    response = client.post(
        "/auth/reset-password",
        json={"token": "invalid-token", "new_password": "NewPassword123"},
    )
    assert response.status_code == 400


def test_reset_password_invalid_token_writes_failure_audit(client: TestClient, db: Session):
    response = client.post(
        "/auth/reset-password",
        json={"token": "invalid-token", "new_password": "NewPassword123"},
    )

    assert response.status_code == 400
    audit = db.scalar(
        select(AuditLog).where(AuditLog.action == "password_reset_denied")
    )
    assert audit is not None
    assert audit.status == "failure"


def test_admin_can_create_invite_and_accept_it(client: TestClient, db: Session):
    admin = User(
        email="invite-admin@example.com",
        password_hash=get_password_hash("AdminPass123"),
        role=UserRole.admin,
    )
    db.add(admin)
    db.commit()

    login_response = client.post(
        "/auth/login",
        json={"email": "invite-admin@example.com", "password": "AdminPass123"},
    )
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    invite_response = client.post(
        "/users/invites",
        json={"email": "doctor@example.com", "role": "doctor"},
        headers=headers,
    )
    assert invite_response.status_code == 200
    invite_url = invite_response.json()["invite_url"]
    assert "/invite#token=" in invite_url
    invite_token = invite_url.split("#token=", 1)[-1]
    assert invite_token

    invite_info_response = client.post(
        "/auth/invite/inspect",
        json={"token": invite_token},
    )
    assert invite_info_response.status_code == 200
    assert invite_info_response.json()["email"] == "doctor@example.com"

    accept_response = client.post(
        "/auth/invite/accept",
        json={
            "token": invite_token,
            "first_name": "Doctor",
            "last_name": "One",
            "password": "DoctorPass123",
            "license_no": "MD-0001",
        },
    )
    assert accept_response.status_code == 200

    login_new_user = client.post(
        "/auth/login",
        json={"email": "doctor@example.com", "password": "DoctorPass123"},
    )
    assert login_new_user.status_code == 200


def test_doctor_cannot_generate_patient_app_code_for_unassigned_patient(
    client: TestClient,
    db: Session,
):
    doctor = User(
        email="doctor-unassigned@example.com",
        password_hash=get_password_hash("DoctorPass123"),
        role=UserRole.doctor,
    )
    patient = Patient(
        first_name="Pat",
        last_name="Unassigned",
        phone="+66812345678",
        date_of_birth=date(1995, 1, 1),
    )
    db.add_all([doctor, patient])
    db.commit()
    db.refresh(patient)

    login_response = client.post(
        "/auth/login",
        json={"email": "doctor-unassigned@example.com", "password": "DoctorPass123"},
    )
    token = login_response.json()["access_token"]

    response = client.post(
        f"/patient-app/{patient.id}/code",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 403
    assert "not assigned" in response.json()["detail"].lower()


def test_invite_link_is_single_use(client: TestClient, db: Session):
    admin = User(
        email="single-admin@example.com",
        password_hash=get_password_hash("AdminPass123"),
        role=UserRole.admin,
    )
    db.add(admin)
    db.commit()

    token = client.post(
        "/auth/login",
        json={"email": "single-admin@example.com", "password": "AdminPass123"},
    ).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    invite_url = client.post(
        "/users/invites",
        json={"email": "single-use@example.com", "role": "doctor"},
        headers=headers,
    ).json()["invite_url"]
    invite_token = invite_url.split("#token=", 1)[-1]

    first_accept = client.post(
        "/auth/invite/accept",
        json={"token": invite_token, "password": "Password123", "license_no": "MD-0002"},
    )
    assert first_accept.status_code == 200

    second_accept = client.post(
        "/auth/invite/accept",
        json={"token": invite_token, "password": "Password123", "license_no": "MD-0002"},
    )
    assert second_accept.status_code == 400


def test_invite_acceptance_marks_used_and_writes_audit(client: TestClient, db: Session):
    admin = User(
        email="invite-audit-admin@example.com",
        password_hash=get_password_hash("AdminPass123"),
        role=UserRole.admin,
    )
    db.add(admin)
    db.commit()

    token = client.post(
        "/auth/login",
        json={"email": "invite-audit-admin@example.com", "password": "AdminPass123"},
    ).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    invite_url = client.post(
        "/users/invites",
        json={"email": "invite-audit-doctor@example.com", "role": "doctor"},
        headers=headers,
    ).json()["invite_url"]
    invite_token = invite_url.split("#token=", 1)[-1]

    accept = client.post(
        "/auth/invite/accept",
        json={
            "token": invite_token,
            "first_name": "Invite",
            "last_name": "Accepted",
            "password": "DoctorPass123",
            "license_no": "MD-1001",
        },
    )
    assert accept.status_code == 200

    invite = db.scalar(
        select(UserInvite).where(UserInvite.email == "invite-audit-doctor@example.com")
    )
    assert invite is not None
    assert invite.used_at is not None

    audit = db.scalar(
        select(AuditLog).where(
            AuditLog.action == "invite_accept",
            AuditLog.resource_id == invite.id,
        )
    )
    assert audit is not None


def test_super_admin_can_create_admin_invite_and_accept_it(client: TestClient, db: Session, monkeypatch):
    monkeypatch.setattr(auth_api.settings, "admin_2fa_required", True)
    monkeypatch.setattr(auth_service.settings, "admin_2fa_required", True)
    secret = generate_totp_secret()
    admin = User(
        email="admin@example.com",
        password_hash=get_password_hash("AdminPass123"),
        role=UserRole.admin,
        two_factor_secret=secret,
    )
    db.add(admin)
    db.commit()

    login_response = client.post(
        "/auth/login",
        json={
            "email": "admin@example.com",
            "password": "AdminPass123",
            "otp_code": generate_totp_code(secret),
        },
    )
    assert login_response.status_code == 200, login_response.text
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    invite_url = client.post(
        "/users/invites",
        json={
            "email": "new-admin@example.com",
            "role": "admin",
            "reason": "Create privileged admin during invite acceptance test",
        },
        headers=headers,
    ).json()["invite_url"]
    invite_token = invite_url.split("#token=", 1)[-1]

    invite_info_response = client.post(
        "/auth/invite/inspect",
        json={"token": invite_token},
    )
    assert invite_info_response.status_code == 200
    assert invite_info_response.json()["role"] == "admin"

    accept_response = client.post(
        "/auth/invite/accept",
        json={
            "token": invite_token,
            "first_name": "New",
            "last_name": "Admin",
            "password": "AdminPass456",
        },
    )
    assert accept_response.status_code == 200

    login_new_user = client.post(
        "/auth/login",
        json={"email": "new-admin@example.com", "password": "AdminPass456"},
    )
    assert login_new_user.status_code == 401
    assert login_new_user.json()["detail"]["code"] == "two_factor_required"


def test_invite_non_clinical_role_rejected(client: TestClient, db: Session):
    admin = User(
        email="invite-admin-2@example.com",
        password_hash=get_password_hash("AdminPass123"),
        role=UserRole.admin,
    )
    db.add(admin)
    db.commit()

    token = client.post(
        "/auth/login",
        json={"email": "invite-admin-2@example.com", "password": "AdminPass123"},
    ).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    response = client.post(
        "/users/invites",
        json={"email": "non-clinical@example.com", "role": "support_agent"},
        headers=headers,
    )
    assert response.status_code == 422


def test_clinical_invite_requires_license_no(client: TestClient, db: Session):
    admin = User(
        email="clinical-invite-admin@example.com",
        password_hash=get_password_hash("AdminPass123"),
        role=UserRole.admin,
    )
    db.add(admin)
    db.commit()

    token = client.post(
        "/auth/login",
        json={"email": "clinical-invite-admin@example.com", "password": "AdminPass123"},
    ).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    invite_url = client.post(
        "/users/invites",
        json={"email": "doctor-clinical@example.com", "role": "doctor"},
        headers=headers,
    ).json()["invite_url"]
    invite_token = invite_url.split("#token=", 1)[-1]

    response = client.post(
        "/auth/invite/accept",
        json={"token": invite_token, "password": "DoctorPass123"},
    )
    assert response.status_code == 422
    assert "license number" in response.json()["detail"].lower()
