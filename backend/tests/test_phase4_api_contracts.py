from datetime import date, datetime, timezone

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


def _create_patient(db: Session, *, first_name: str, last_name: str) -> Patient:
    patient = Patient(
        first_name=first_name,
        last_name=last_name,
        date_of_birth=date(1991, 1, 1),
    )
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


def test_audit_logs_contract_returns_status_field(client: TestClient, db: Session):
    admin = _create_user(db, email="admin@example.com", role=UserRole.admin)
    db.add(
        AuditLog(
            user_id=admin.id,
            action="contract_status",
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
    assert payload["items"][0]["status"] == "success"
    assert "result" not in payload["items"][0]


def test_patient_presence_contract_returns_patient_joined_at(
    client: TestClient,
    db: Session,
):
    doctor = _create_user(db, email="presence-contract-doctor@example.com", role=UserRole.doctor)
    patient = _create_patient(db, first_name="Presence", last_name="Contract")
    meeting = Meeting(
        doctor_id=doctor.id,
        user_id=patient.id,
        date_time=datetime.now(timezone.utc),
    )
    db.add(meeting)
    db.commit()
    db.refresh(meeting)

    invite_response = client.post(
        f"/meetings/{meeting.id}/video/patient-invite",
        json={},
        headers=_auth_headers(doctor, db),
    )
    assert invite_response.status_code == 200, invite_response.text

    heartbeat_response = client.post(
        "/meetings/video/patient/presence/heartbeat",
        json={"invite_token": invite_response.json()["invite_token"]},
    )

    assert heartbeat_response.status_code == 200, heartbeat_response.text
    payload = heartbeat_response.json()
    assert payload["meeting_id"] == str(meeting.id)
    assert payload["patient_joined_at"] is not None
