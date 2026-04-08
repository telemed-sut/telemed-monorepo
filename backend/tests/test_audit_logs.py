import csv
import io
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models.audit_log import AuditLog
from app.models.enums import UserRole
from app.models.user import User
from app.services import audit as audit_service


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


def test_audit_logs_filter_by_user_result_and_date(client: TestClient, db: Session):
    admin = _make_user(db, email="admin-audit-filter@example.com", role=UserRole.admin)
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
    token = _login(client, admin.email)

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
    admin = _make_user(db, email="admin-audit-export@example.com", role=UserRole.admin)
    doctor = _make_user(db, email="doctor-audit-export@example.com", role=UserRole.doctor)
    token = _login(client, admin.email)

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
    admin = _make_user(db, email="admin-audit-infer@example.com", role=UserRole.admin)
    doctor = _make_user(db, email="doctor-audit-infer@example.com", role=UserRole.doctor)
    token = _login(client, admin.email)

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
    admin = _make_user(db, email="admin-audit-dict-query@example.com", role=UserRole.admin)
    target = _make_user(db, email="doctor-audit-dict-query@example.com", role=UserRole.doctor)
    token = _login(client, admin.email)

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
    admin = _make_user(db, email="admin-audit-dict-export@example.com", role=UserRole.admin)
    target = _make_user(db, email="doctor-audit-dict-export@example.com", role=UserRole.doctor)
    token = _login(client, admin.email)

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
