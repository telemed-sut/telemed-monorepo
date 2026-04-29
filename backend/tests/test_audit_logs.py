import csv
import io
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models.audit_log import AuditLog
from app.models.enums import PrivilegedRole, UserRole
from app.models.user import User
from app.models.user_privileged_role_assignment import UserPrivilegedRoleAssignment
from app.services import audit as audit_service
from app.services.auth import create_login_response


def _make_user(
    db: Session,
    *,
    email: str,
    role: UserRole,
    first_name: str | None = None,
    last_name: str | None = None,
    password: str = "TestPass123",
) -> User:
    user = User(
        email=email,
        password_hash=get_password_hash(password),
        role=role,
        is_active=True,
        first_name=first_name,
        last_name=last_name,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _login(client: TestClient, email: str, password: str = "TestPass123") -> str:
    response = client.post("/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def _mint_token(db: Session, user: User, **kwargs) -> str:
    token = create_login_response(user, db=db, **kwargs)["access_token"]
    db.commit()
    return token


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _write_audit_log(
    db: Session,
    *,
    action: str,
    user: User | None,
    details: dict | None = None,
    created_at: datetime | None = None,
    status: str | None = None,
) -> AuditLog:
    log_kwargs = dict(
        user_id=user.id if user else None,
        action=action,
        resource_type="user",
        details=details or {},
        ip_address="127.0.0.1",
        is_break_glass=False,
        created_at=created_at or datetime.now(timezone.utc),
    )
    if status is not None:
        log_kwargs["status"] = status

    log = AuditLog(**log_kwargs)
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


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
        reason="audit test privilege grant",
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return assignment


def test_audit_logs_filter_by_user_result_and_date(client: TestClient, db: Session):
    admin = _make_user(db, email="admin@example.com", role=UserRole.admin)
    doctor = _make_user(
        db,
        email="doctor-audit-filter@example.com",
        role=UserRole.doctor,
        first_name="Audit",
        last_name="Doctor",
    )
    other = _make_user(
        db,
        email="medical-student-audit-filter@example.com",
        role=UserRole.medical_student,
    )
    token = _mint_token(db, admin)

    now = datetime.now(timezone.utc)
    yesterday = now - timedelta(days=1)

    _write_audit_log(
        db,
        action="user_update",
        user=doctor,
        details={"success": False, "reason": "today failure"},
        created_at=now,
        status="failure",
    )
    _write_audit_log(
        db,
        action="user_update",
        user=doctor,
        details={"success": True, "reason": "today success"},
        created_at=now,
        status="success",
    )
    _write_audit_log(
        db,
        action="user_update",
        user=doctor,
        details={"success": False, "reason": "yesterday failure"},
        created_at=yesterday,
        status="failure",
    )
    _write_audit_log(
        db,
        action="user_delete_denied",
        user=other,
        details={"success": False, "reason": "other user"},
        created_at=now,
        status="failure",
    )

    response = client.get(
        f"/audit/logs?user={doctor.email}&result=failure&date_from={now.date().isoformat()}",
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    # total is no longer returned due to cursor pagination
    assert len(payload["items"]) == 1
    assert payload["items"][0]["user_email"] == doctor.email
    assert payload["items"][0]["status"] == "failure"


def test_audit_export_honors_user_and_result_filters(client: TestClient, db: Session):
    admin = _make_user(db, email="admin@example.com", role=UserRole.admin)
    doctor = _make_user(db, email="doctor-audit-export@example.com", role=UserRole.doctor)
    token = _mint_token(db, admin)

    _write_audit_log(
        db,
        action="user_verify",
        user=doctor,
        details={"success": True, "message": "verified"},
        status="success",
    )
    _write_audit_log(
        db,
        action="user_update",
        user=doctor,
        details={"success": False, "message": "denied"},
        status="failure",
    )

    response = client.get(
        f"/audit/export?user={doctor.email}&result=success",
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text
    content_type = response.headers.get("content-type", "")
    assert content_type.startswith("text/csv")

    csv_text = response.content.decode("utf-8")
    rows = list(csv.DictReader(io.StringIO(csv_text)))
    response.close()
    assert len(rows) == 1
    assert rows[0]["User Email"] == doctor.email
    assert rows[0]["Result"] == "success"


def test_audit_logs_infers_failure_status_when_omitted(client: TestClient, db: Session):
    admin = _make_user(db, email="admin@example.com", role=UserRole.admin)
    doctor = _make_user(db, email="doctor-audit-infer@example.com", role=UserRole.doctor)
    token = _mint_token(db, admin)

    # Intentionally omit status to verify model-level inference for "failed" actions.
    _write_audit_log(
        db,
        action="login_failed",
        user=doctor,
        details={"reason": "bad password"},
        status=None,
    )

    response = client.get(
        f"/audit/logs?user={doctor.email}&result=failure",
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert len(payload["items"]) == 1
    assert payload["items"][0]["action"] == "login_failed"
    assert payload["items"][0]["status"] == "failure"


def test_audit_logs_query_returns_dict_details_for_jsonb_rows(client: TestClient, db: Session):
    admin = _make_user(db, email="admin@example.com", role=UserRole.admin)
    target = _make_user(db, email="doctor-audit-dict-query@example.com", role=UserRole.doctor)
    token = _mint_token(db, admin)

    _write_audit_log(
        db,
        action="user_update",
        user=target,
        details={"success": False, "reason": "query dict payload"},
        status="failure",
    )

    response = client.get(f"/audit/logs?user={target.email}", headers=_auth(token))
    assert response.status_code == 200, response.text
    payload = response.json()
    assert len(payload["items"]) == 1
    assert isinstance(payload["items"][0]["details"], dict)
    assert payload["items"][0]["details"]["reason"] == "query dict payload"


def test_audit_export_serializes_dict_details_for_csv_reports(client: TestClient, db: Session):
    admin = _make_user(db, email="admin@example.com", role=UserRole.admin)
    target = _make_user(db, email="doctor-audit-dict-export@example.com", role=UserRole.doctor)
    token = _mint_token(db, admin)

    _write_audit_log(
        db,
        action="user_update",
        user=target,
        details={"success": False, "reason": "export dict payload"},
        status="failure",
    )

    response = client.get(f"/audit/export?user={target.email}", headers=_auth(token))
    assert response.status_code == 200, response.text

    csv_text = response.content.decode("utf-8")
    rows = list(csv.DictReader(io.StringIO(csv_text)))
    response.close()
    assert len(rows) == 1
    assert rows[0]["Details"].startswith("{")
    assert '"reason": "export dict payload"' in rows[0]["Details"]


def test_audit_logs_deny_ordinary_admin_without_security_operations_access(client: TestClient, db: Session):
    admin = _make_user(db, email="regular-audit-admin@example.com", role=UserRole.admin)
    token = _mint_token(db, admin)

    response = client.get("/audit/logs", headers=_auth(token))
    export_response = client.get("/audit/export", headers=_auth(token))

    assert response.status_code == 403
    assert response.json()["detail"] == "Security admin only."
    assert export_response.status_code == 403
    assert export_response.json()["detail"] == "Security admin only."


def test_audit_logs_require_recent_mfa_for_security_operations_admin(client: TestClient, db: Session):
    bootstrap_admin = _make_user(db, email="admin@example.com", role=UserRole.admin)
    security_admin = _make_user(db, email="security-audit-admin@example.com", role=UserRole.admin)
    _grant_privileged_role(
        db,
        user=security_admin,
        role=PrivilegedRole.security_admin,
        created_by=bootstrap_admin,
    )
    stale_token = _mint_token(
        db,
        security_admin,
        mfa_verified=True,
        mfa_authenticated_at=datetime.now(timezone.utc) - timedelta(hours=1),
    )

    response = client.get("/audit/logs", headers=_auth(stale_token))

    assert response.status_code == 401
    assert "Recent multi-factor verification required" in response.json()["detail"]


def test_audit_reads_redact_nested_sensitive_fields_in_json_and_csv(client: TestClient, db: Session):
    admin = _make_user(db, email="admin@example.com", role=UserRole.admin)
    target = _make_user(db, email="audit-redacted-target@example.com", role=UserRole.doctor)
    token = _mint_token(db, admin)

    _write_audit_log(
        db,
        action="user_update",
        user=target,
        details={
            "email": "patient@example.com",
            "nested": {"phone": "+6600000000", "note": "keep-me"},
            "items": [{"session_id": "session-123"}],
        },
        status="success",
    )

    logs_response = client.get("/audit/logs", headers=_auth(token))
    assert logs_response.status_code == 200, logs_response.text
    log_item = logs_response.json()["items"][0]
    assert log_item["details"]["email"] == "[REDACTED]"
    assert log_item["details"]["nested"]["phone"] == "[REDACTED]"
    assert log_item["details"]["nested"]["note"] == "keep-me"
    assert log_item["details"]["items"][0]["session_id"] == "[REDACTED]"

    export_response = client.get("/audit/export", headers=_auth(token))
    assert export_response.status_code == 200, export_response.text
    rows = list(csv.DictReader(io.StringIO(export_response.content.decode("utf-8"))))
    export_response.close()
    assert "[REDACTED]" in rows[0]["Details"]
    assert "patient@example.com" not in rows[0]["Details"]


def test_log_action_emits_structured_audit_log_without_sensitive_details(db: Session, monkeypatch):
    admin = _make_user(db, email="admin-audit-stream@example.com", role=UserRole.admin)
    captured_calls = []

    monkeypatch.setattr(
        audit_service.logger,
        "info",
        lambda message, *args, **kwargs: captured_calls.append((message, kwargs)),
    )

    audit_service.log_action(
        db,
        user_id=admin.id,
        action="user_update",
        resource_type="user",
        resource_id=uuid4(),
        details={"password": "do-not-log-me", "token": "do-not-log-me"},
        ip_address="203.0.113.10",
        status="success",
    )

    assert len(captured_calls) == 1
    message, kwargs = captured_calls[0]
    assert message == "audit_log_event"
    assert kwargs["extra"]["event_type"] == "audit_log"
    assert kwargs["extra"]["action"] == "user_update"
    assert kwargs["extra"]["user_id"] == str(admin.id)
    assert kwargs["extra"]["ip_address"] == "203.0.113.10"
    assert kwargs["extra"]["status"] == "success"
    assert "details" not in kwargs["extra"]
