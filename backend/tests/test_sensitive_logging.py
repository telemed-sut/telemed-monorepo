from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api import security as security_api
from app.api import users as users_api
from app.core.security import get_password_hash
from app.models.enums import PrivilegedRole, UserRole
from app.models.user import User
from app.models.user_privileged_role_assignment import UserPrivilegedRoleAssignment
from app.services import security as security_service
from app.services.auth import create_login_response


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


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _mint_token(db: Session, user: User, **kwargs) -> str:
    token = create_login_response(user, db=db, **kwargs)["access_token"]
    db.commit()
    return token


def _grant_privileged_role(
    db: Session,
    *,
    user: User,
    role: PrivilegedRole,
    created_by: User | None = None,
) -> UserPrivilegedRoleAssignment:
    assignment = UserPrivilegedRoleAssignment(
        user_id=user.id,
        role=role,
        created_by=created_by.id if created_by else None,
        reason="sensitive logging regression test",
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return assignment


def test_handle_failed_login_uses_generic_lock_messages(db: Session, monkeypatch):
    user = _make_user(db, email="locked-clinical@example.com", role=UserRole.doctor)
    user.failed_login_attempts = 4
    db.add(user)
    db.commit()
    captured_calls: list[tuple[str, dict[str, object]]] = []

    monkeypatch.setattr(
        security_service.logger,
        "warning",
        lambda message, *args, **kwargs: captured_calls.append((message, kwargs)),
    )

    security_service.handle_failed_login(
        db,
        "203.0.113.9",
        "locked-clinical@example.com",
        user,
        details="bad password",
    )

    assert captured_calls
    message, kwargs = captured_calls[0]
    assert message == "Clinical account temporarily locked"
    assert kwargs["extra"]["email"] == "locked-clinical@example.com"
    assert kwargs["extra"]["failed_attempts"] == 5
    assert "locked-clinical@example.com" not in message


def test_emergency_unlock_logs_generic_message_with_structured_context(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    bootstrap_admin = _make_user(db, email="admin@example.com", role=UserRole.admin)
    security_admin = _make_user(db, email="security-logger@example.com", role=UserRole.admin)
    target_admin = _make_user(db, email="target-logger@example.com", role=UserRole.admin)
    target_admin.failed_login_attempts = 6
    target_admin.account_locked_until = datetime.now(timezone.utc) + timedelta(minutes=5)
    db.add(target_admin)
    db.commit()
    _grant_privileged_role(
        db,
        user=security_admin,
        role=PrivilegedRole.security_admin,
        created_by=bootstrap_admin,
    )
    token = _mint_token(db, security_admin)
    captured_calls: list[tuple[str, dict[str, object]]] = []

    monkeypatch.setattr(
        security_api.logger,
        "info",
        lambda message, *args, **kwargs: captured_calls.append((message, kwargs)),
    )

    response = client.post(
        "/security/admin-unlock",
        json={"email": target_admin.email, "reason": "Security review unlock path"},
        headers=_auth_headers(token),
    )

    assert response.status_code == 200, response.text
    assert captured_calls
    message, kwargs = captured_calls[0]
    assert message == "Admin account emergency unlock completed"
    assert kwargs["extra"]["target_user_id"] == str(target_admin.id)
    assert kwargs["extra"]["actor_user_id"] == str(security_admin.id)
    assert "target_user_id=" not in message


def test_doctor_onboarding_assignment_logs_generic_message(db: Session, monkeypatch):
    captured_calls: list[tuple[str, dict[str, object]]] = []

    monkeypatch.setattr(
        users_api.logger,
        "info",
        lambda message, *args, **kwargs: captured_calls.append((message, kwargs)),
    )

    users_api._assign_patients_to_new_doctor(
        db=db,
        doctor_id=uuid4(),
        scope="all",
        target_ward=None,
    )

    assert captured_calls
    message, kwargs = captured_calls[0]
    assert message == "Doctor onboarding auto-assignment found no eligible patients"
    assert "doctor_id=" not in message
    assert "doctor_id" in kwargs["extra"]
