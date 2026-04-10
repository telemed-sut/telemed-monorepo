from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models.enums import UserRole
from app.models.user import User
from app.services.auth import create_login_response


def _create_user(db: Session, *, email: str, role: UserRole) -> User:
    user = User(
        email=email,
        password_hash=get_password_hash("TestPass123"),
        role=role,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _assert_security_headers(response) -> None:
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["X-XSS-Protection"] == "0"
    assert response.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert response.headers["Permissions-Policy"] == "camera=(), microphone=(), geolocation=()"
    assert response.headers["Cache-Control"] == "no-store"


def test_security_headers_are_applied_to_public_health_response(client: TestClient):
    response = client.get("/health")

    assert response.status_code == 200
    _assert_security_headers(response)


def test_security_headers_are_applied_to_authenticated_auth_response(
    client: TestClient,
    db: Session,
):
    admin = _create_user(db, email="headers-admin@example.com", role=UserRole.admin)
    token = create_login_response(admin, db=db)["access_token"]
    db.commit()

    response = client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200, response.text
    _assert_security_headers(response)


def test_security_headers_are_applied_to_validation_error_response(client: TestClient):
    response = client.post(
        "/patient-app/login",
        json={
            "phone": "0812345678",
            "pin": "abcd",
        },
    )

    assert response.status_code == 422
    _assert_security_headers(response)
