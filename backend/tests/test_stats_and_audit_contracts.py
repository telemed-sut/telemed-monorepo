from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, object_session

from app.core.security import get_password_hash
from app.models.audit_log import AuditLog
from app.models.enums import UserRole
from app.models.meeting import Meeting
from app.models.patient import Patient
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


def _auth_headers(user: User, db: Session | None = None) -> dict[str, str]:
    session = db or object_session(user)
    token = create_login_response(user, db=session)["access_token"]
    session.commit()
    return {"Authorization": f"Bearer {token}"}


def _create_patient(
    db: Session,
    *,
    first_name: str,
    last_name: str,
    created_at: datetime,
) -> Patient:
    patient = Patient(
        first_name=first_name,
        last_name=last_name,
        date_of_birth=date(1991, 1, 1),
        created_at=created_at,
    )
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


def test_stats_overview_returns_expected_contract(
    client: TestClient,
    db: Session,
):
    admin = _create_user(db, email="stats-admin@example.com", role=UserRole.admin)
    now = datetime.now(timezone.utc)
    patient = _create_patient(
        db,
        first_name="Stats",
        last_name="Patient",
        created_at=now - timedelta(days=1),
    )
    db.add(
        Meeting(
            doctor_id=admin.id,
            user_id=patient.id,
            date_time=now,
        )
    )
    db.commit()

    response = client.get("/stats/overview", headers=_auth_headers(admin, db))

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["year"] == now.year
    assert len(payload["monthly"]) == 12
    assert {"month", "new_patients", "consultations"} <= set(payload["monthly"][0].keys())
    assert payload["totals"]["patients"] >= 1
    assert payload["totals"]["meetings"] >= 1
    assert {"today_consultations", "this_week_consultations", "this_month_new_patients"} <= set(
        payload["kpis"].keys()
    )


def test_audit_endpoints_require_admin_role(client: TestClient, db: Session):
    medical_student = _create_user(db, email="audit-medical-student@example.com", role=UserRole.medical_student)
    headers = _auth_headers(medical_student, db)

    logs_response = client.get("/audit/logs", headers=headers)
    export_response = client.get("/audit/export", headers=headers)

    assert logs_response.status_code == 403
    assert export_response.status_code == 403


def test_audit_logs_cursor_contract_for_admin(client: TestClient, db: Session):
    admin = _create_user(db, email="admin@example.com", role=UserRole.admin)
    db.add(
        AuditLog(
            user_id=admin.id,
            action="contract_check",
            resource_type="test",
            details={"ok": True},
            ip_address="127.0.0.1",
            is_break_glass=False,
            status="success",
        )
    )
    db.commit()

    response = client.get("/audit/logs?limit=1", headers=_auth_headers(admin, db))

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["limit"] == 1
    assert len(payload["items"]) == 1
    assert payload["items"][0]["action"] == "contract_check"
    assert payload["items"][0]["status"] == "success"
    assert "next_cursor" in payload
