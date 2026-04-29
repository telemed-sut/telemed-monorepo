from uuid import uuid4

from sqlalchemy.orm import Session

from app.api import users as users_api
from app.core.security import get_password_hash
from app.models.enums import UserRole
from app.models.user import User
from app.services import security as security_service


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
