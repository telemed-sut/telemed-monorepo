import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.invite import UserInvite
from app.models.user import User, UserRole
from app.core.security import get_password_hash


def test_login_endpoint(client: TestClient, db: Session):
    """Test login endpoint"""
    # Create test user
    user = User(
        email="test@example.com",
        password_hash=get_password_hash("TestPassword123"),
        role=UserRole.staff
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
    assert "set-cookie" in response.headers


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
    response = client.post("/auth/refresh")
    assert response.status_code == 200
    assert "access_token" in response.json()


def test_logout_endpoint(client: TestClient, db: Session):
    """Test logout endpoint"""
    # Create user and login
    user = User(
        email="logout@example.com",
        password_hash=get_password_hash("TestPassword123"),
        role=UserRole.staff
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
        role=UserRole.staff
    )
    db.add(user)
    db.commit()

    response = client.post("/auth/forgot-password", json={"email": "forgot@example.com"})
    assert response.status_code == 200
    assert "message" in response.json()


def test_reset_password_with_valid_token(client: TestClient, db: Session, monkeypatch):
    """Reset password should update stored password hash when token is valid"""
    user = User(
        email="reset@example.com",
        password_hash=get_password_hash("OldPassword123"),
        role=UserRole.staff
    )
    db.add(user)
    db.commit()

    monkeypatch.setenv("PASSWORD_RESET_RETURN_TOKEN_IN_RESPONSE", "true")
    from app.core.config import get_settings
    get_settings.cache_clear()

    forgot_response = client.post("/auth/forgot-password", json={"email": "reset@example.com"})
    reset_token = forgot_response.json().get("reset_token")
    assert reset_token

    reset_response = client.post(
        "/auth/reset-password",
        json={"token": reset_token, "new_password": "NewPassword123"},
    )
    assert reset_response.status_code == 200

    login_response = client.post("/auth/login", json={"email": "reset@example.com", "password": "NewPassword123"})
    assert login_response.status_code == 200
    get_settings.cache_clear()


def test_reset_password_with_invalid_token(client: TestClient):
    response = client.post(
        "/auth/reset-password",
        json={"token": "invalid-token", "new_password": "NewPassword123"},
    )
    assert response.status_code == 400


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
    invite_token = invite_url.rsplit("/", 1)[-1]
    assert invite_token

    invite_info_response = client.get(f"/auth/invite/{invite_token}")
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
    invite_token = invite_url.rsplit("/", 1)[-1]

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
    invite_token = invite_url.rsplit("/", 1)[-1]

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
        json={"email": "non-clinical@example.com", "role": "staff"},
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
    invite_token = invite_url.rsplit("/", 1)[-1]

    response = client.post(
        "/auth/invite/accept",
        json={"token": invite_token, "password": "DoctorPass123"},
    )
    assert response.status_code == 422
    assert "license number" in response.json()["detail"].lower()
