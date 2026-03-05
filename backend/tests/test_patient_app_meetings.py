from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token, get_password_hash
from app.models.meeting import Meeting
from app.models.meeting_patient_invite_code import MeetingPatientInviteCode
from app.models.patient import Patient
from app.models.user import User, UserRole


def _create_user(db: Session, email: str, role: UserRole) -> User:
    user = User(
        email=email,
        password_hash=get_password_hash("TestPassword123"),
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _create_patient(db: Session, first_name: str, last_name: str) -> Patient:
    patient = Patient(
        first_name=first_name,
        last_name=last_name,
        phone="+66812345678",
        pin_hash=get_password_hash("123456"),
        date_of_birth=date(1992, 1, 1),
    )
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


def _create_meeting(
    db: Session,
    *,
    doctor_id,
    patient_id,
) -> Meeting:
    meeting = Meeting(
        doctor_id=doctor_id,
        user_id=patient_id,
        date_time=datetime.now(timezone.utc),
    )
    db.add(meeting)
    db.commit()
    db.refresh(meeting)
    return meeting


def _patient_auth_headers(patient: Patient) -> dict[str, str]:
    token = create_access_token(
        {
            "sub": str(patient.id),
            "type": "patient",
            "role": "patient",
        },
        expires_in=3_600,
    )
    return {"Authorization": f"Bearer {token}"}


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def test_patient_meetings_auto_generates_invite_when_missing(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    monkeypatch.setenv("MEETING_PATIENT_JOIN_BASE_URL", "https://demo.trycloudflare.com")
    get_settings.cache_clear()

    doctor = _create_user(db, "doctor-auto-invite@example.com", UserRole.doctor)
    patient = _create_patient(db, "Auto", "Invite")
    meeting = _create_meeting(db, doctor_id=doctor.id, patient_id=patient.id)

    response = client.get(
        "/patient-app/me/meetings",
        headers=_patient_auth_headers(patient),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    invite_url = payload["items"][0]["patient_invite_url"]
    assert invite_url.startswith("https://demo.trycloudflare.com/p/")

    db.refresh(meeting)
    assert meeting.patient_invite_url == invite_url

    invite_code = db.scalar(
        select(MeetingPatientInviteCode)
        .where(MeetingPatientInviteCode.meeting_id == meeting.id)
        .order_by(MeetingPatientInviteCode.created_at.desc())
    )
    assert invite_code is not None
    assert _as_utc(invite_code.expires_at) > datetime.now(timezone.utc)

    get_settings.cache_clear()


def test_patient_meetings_regenerates_invite_when_latest_code_expired(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    monkeypatch.setenv("MEETING_PATIENT_JOIN_BASE_URL", "https://demo.trycloudflare.com")
    get_settings.cache_clear()

    doctor = _create_user(db, "doctor-expired-invite@example.com", UserRole.doctor)
    patient = _create_patient(db, "Expired", "Invite")
    meeting = _create_meeting(db, doctor_id=doctor.id, patient_id=patient.id)

    old_code = "ABCDEF"
    old_url = f"https://demo.trycloudflare.com/p/{old_code}"
    meeting.patient_invite_url = old_url
    db.add(
        MeetingPatientInviteCode(
            meeting_id=meeting.id,
            code=old_code,
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        )
    )
    db.add(meeting)
    db.commit()

    response = client.get(
        "/patient-app/me/meetings",
        headers=_patient_auth_headers(patient),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    invite_url = payload["items"][0]["patient_invite_url"]
    assert invite_url.startswith("https://demo.trycloudflare.com/p/")
    assert invite_url != old_url

    invite_codes = db.scalars(
        select(MeetingPatientInviteCode).where(MeetingPatientInviteCode.meeting_id == meeting.id)
    ).all()
    assert len(invite_codes) >= 2
    assert any(
        code.code != old_code and _as_utc(code.expires_at) > datetime.now(timezone.utc)
        for code in invite_codes
    )

    get_settings.cache_clear()
