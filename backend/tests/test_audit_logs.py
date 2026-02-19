import csv
import io
import json
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models.audit_log import AuditLog
from app.models.enums import UserRole
from app.models.user import User


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
) -> AuditLog:
    log = AuditLog(
        user_id=user.id if user else None,
        action=action,
        resource_type="user",
        details=json.dumps(details or {}),
        ip_address="127.0.0.1",
        is_break_glass=False,
        created_at=created_at or datetime.now(timezone.utc),
    )
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
    other = _make_user(db, email="staff-audit-filter@example.com", role=UserRole.staff)
    token = _login(client, admin.email)

    now = datetime.now(timezone.utc)
    yesterday = now - timedelta(days=1)

    _write_audit_log(
        db,
        action="user_update",
        user=doctor,
        details={"success": False, "reason": "today failure"},
        created_at=now,
    )
    _write_audit_log(
        db,
        action="user_update",
        user=doctor,
        details={"success": True, "reason": "today success"},
        created_at=now,
    )
    _write_audit_log(
        db,
        action="user_update",
        user=doctor,
        details={"success": False, "reason": "yesterday failure"},
        created_at=yesterday,
    )
    _write_audit_log(
        db,
        action="user_delete_denied",
        user=other,
        details={"success": False, "reason": "other user"},
        created_at=now,
    )

    response = client.get(
        f"/audit/logs?user={doctor.email}&result=failure&date_from={now.date().isoformat()}",
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 1
    assert len(payload["items"]) == 1
    assert payload["items"][0]["user_email"] == doctor.email
    assert payload["items"][0]["result"] == "failure"


def test_audit_export_honors_user_and_result_filters(client: TestClient, db: Session):
    admin = _make_user(db, email="admin-audit-export@example.com", role=UserRole.admin)
    doctor = _make_user(db, email="doctor-audit-export@example.com", role=UserRole.doctor)
    token = _login(client, admin.email)

    _write_audit_log(
        db,
        action="user_verify",
        user=doctor,
        details={"success": True, "message": "verified"},
    )
    _write_audit_log(
        db,
        action="user_update",
        user=doctor,
        details={"success": False, "message": "denied"},
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
    assert len(rows) == 1
    assert rows[0]["User Email"] == doctor.email
    assert rows[0]["Result"] == "success"
