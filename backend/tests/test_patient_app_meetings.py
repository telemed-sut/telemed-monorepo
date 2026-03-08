from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token, get_password_hash
from app.models.enums import MeetingStatus
from app.models.meeting import Meeting
from app.models.meeting_room_presence import MeetingRoomPresence
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


def test_patient_meetings_does_not_generate_invite_when_missing(
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
    assert payload["items"][0]["patient_invite_url"] is None
    assert payload["items"][0]["patient_invite_expires_at"] is None
    assert payload["items"][0]["updated_at"] is not None

    db.refresh(meeting)
    assert meeting.patient_invite_url is None

    invite_code = db.scalar(
        select(MeetingPatientInviteCode)
        .where(MeetingPatientInviteCode.meeting_id == meeting.id)
        .order_by(MeetingPatientInviteCode.created_at.desc())
    )
    assert invite_code is None

    get_settings.cache_clear()


def test_patient_meetings_hides_expired_invite_from_list(
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
    assert payload["items"][0]["patient_invite_url"] is None
    assert payload["items"][0]["patient_invite_expires_at"] is None

    invite_codes = db.scalars(
        select(MeetingPatientInviteCode).where(MeetingPatientInviteCode.meeting_id == meeting.id)
    ).all()
    assert len(invite_codes) == 1
    assert invite_codes[0].code == old_code

    get_settings.cache_clear()


def test_patient_meetings_reuses_any_active_invite_without_regenerating(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    monkeypatch.setenv("MEETING_PATIENT_JOIN_BASE_URL", "https://demo.trycloudflare.com")
    get_settings.cache_clear()

    doctor = _create_user(db, "doctor-reuse-active-invite@example.com", UserRole.doctor)
    patient = _create_patient(db, "Reuse", "Invite")
    meeting = _create_meeting(db, doctor_id=doctor.id, patient_id=patient.id)

    active_code = "active1"
    expired_code = "expire1"
    active_url = f"https://demo.trycloudflare.com/p/{active_code}"
    meeting.patient_invite_url = active_url
    db.add_all(
        [
            MeetingPatientInviteCode(
                meeting_id=meeting.id,
                code=active_code,
                expires_at=datetime.now(timezone.utc) + timedelta(hours=2),
            ),
            MeetingPatientInviteCode(
                meeting_id=meeting.id,
                code=expired_code,
                expires_at=datetime.now(timezone.utc) - timedelta(minutes=5),
            ),
        ]
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
    assert payload["items"][0]["patient_invite_url"] == active_url
    assert payload["items"][0]["patient_invite_expires_at"] is not None

    invite_codes = db.scalars(
        select(MeetingPatientInviteCode)
        .where(MeetingPatientInviteCode.meeting_id == meeting.id)
        .order_by(MeetingPatientInviteCode.created_at.asc())
    ).all()
    assert len(invite_codes) == 2
    assert {code.code for code in invite_codes} == {active_code, expired_code}

    get_settings.cache_clear()


def test_patient_can_issue_invite_explicitly_for_owned_meeting(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    monkeypatch.setenv("MEETING_PATIENT_JOIN_BASE_URL", "https://demo.trycloudflare.com")
    get_settings.cache_clear()

    doctor = _create_user(db, "doctor-explicit-invite@example.com", UserRole.doctor)
    patient = _create_patient(db, "Explicit", "Invite")
    meeting = _create_meeting(db, doctor_id=doctor.id, patient_id=patient.id)

    response = client.post(
        f"/patient-app/me/meetings/{meeting.id}/invite",
        headers=_patient_auth_headers(patient),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meeting_id"] == str(meeting.id)
    assert payload["invite_url"].startswith("https://demo.trycloudflare.com/p/")
    assert payload["short_code"]

    db.refresh(meeting)
    assert meeting.patient_invite_url == payload["invite_url"]

    invite_code = db.scalar(
        select(MeetingPatientInviteCode)
        .where(MeetingPatientInviteCode.meeting_id == meeting.id)
        .order_by(MeetingPatientInviteCode.created_at.desc())
    )
    assert invite_code is not None
    assert _as_utc(invite_code.expires_at) > datetime.now(timezone.utc)

    get_settings.cache_clear()


def test_patient_explicit_invite_reuses_active_code(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    monkeypatch.setenv("MEETING_PATIENT_JOIN_BASE_URL", "https://demo.trycloudflare.com")
    get_settings.cache_clear()

    doctor = _create_user(db, "doctor-explicit-reuse@example.com", UserRole.doctor)
    patient = _create_patient(db, "Reuse", "Explicit")
    meeting = _create_meeting(db, doctor_id=doctor.id, patient_id=patient.id)

    active_code = "active11"
    active_url = f"https://demo.trycloudflare.com/p/{active_code}"
    meeting.patient_invite_url = active_url
    db.add(
        MeetingPatientInviteCode(
            meeting_id=meeting.id,
            code=active_code,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=2),
        )
    )
    db.add(meeting)
    db.commit()

    response = client.post(
        f"/patient-app/me/meetings/{meeting.id}/invite",
        headers=_patient_auth_headers(patient),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["invite_url"] == active_url
    assert payload["short_code"] == active_code
    assert payload["invite_token"].startswith("pjoin.")

    invite_codes = db.scalars(
        select(MeetingPatientInviteCode).where(MeetingPatientInviteCode.meeting_id == meeting.id)
    ).all()
    assert len(invite_codes) == 1

    get_settings.cache_clear()


def test_patient_meetings_can_delta_sync_by_updated_after(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    monkeypatch.setenv("MEETING_PATIENT_JOIN_BASE_URL", "https://demo.trycloudflare.com")
    get_settings.cache_clear()

    doctor = _create_user(db, "doctor-delta-sync@example.com", UserRole.doctor)
    patient = _create_patient(db, "Delta", "Sync")
    older_meeting = _create_meeting(db, doctor_id=doctor.id, patient_id=patient.id)
    newer_meeting = _create_meeting(db, doctor_id=doctor.id, patient_id=patient.id)

    older_meeting.updated_at = datetime.now(timezone.utc) - timedelta(hours=2)
    newer_meeting.updated_at = datetime.now(timezone.utc)
    db.add_all([older_meeting, newer_meeting])
    db.commit()

    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
    response = client.get(
        f"/patient-app/me/meetings?updated_after={cutoff}",
        headers=_patient_auth_headers(patient),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["id"] == str(newer_meeting.id)

    get_settings.cache_clear()


@pytest.mark.meeting_presence_regression
def test_patient_meetings_include_room_presence(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    monkeypatch.setenv("MEETING_PATIENT_JOIN_BASE_URL", "https://demo.trycloudflare.com")
    get_settings.cache_clear()

    doctor = _create_user(db, "doctor-patient-presence@example.com", UserRole.doctor)
    patient = _create_patient(db, "Presence", "Visible")
    meeting = _create_meeting(db, doctor_id=doctor.id, patient_id=patient.id)
    db.add(
        MeetingRoomPresence(
            meeting_id=meeting.id,
            doctor_last_seen_at=datetime.now(timezone.utc),
            patient_last_seen_at=datetime.now(timezone.utc),
            refreshed_at=datetime.now(timezone.utc),
        )
    )
    db.commit()

    response = client.get(
        "/patient-app/me/meetings",
        headers=_patient_auth_headers(patient),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    room_presence = payload["items"][0]["room_presence"]
    assert room_presence is not None
    assert room_presence["state"] == "both_in_room"
    assert room_presence["doctor_online"] is True
    assert room_presence["patient_online"] is True

    get_settings.cache_clear()


@pytest.mark.meeting_presence_regression
def test_patient_meetings_does_not_prune_stale_waiting_status(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    monkeypatch.setenv("MEETING_PATIENT_JOIN_BASE_URL", "https://demo.trycloudflare.com")
    get_settings.cache_clear()

    doctor = _create_user(db, "doctor-patient-stale@example.com", UserRole.doctor)
    patient = _create_patient(db, "Stale", "Waiting")
    meeting = _create_meeting(db, doctor_id=doctor.id, patient_id=patient.id)
    meeting.status = MeetingStatus.waiting
    db.add(meeting)
    db.add(
        MeetingRoomPresence(
            meeting_id=meeting.id,
            patient_last_seen_at=datetime.now(timezone.utc) - timedelta(minutes=2),
            refreshed_at=datetime.now(timezone.utc) - timedelta(minutes=2),
        )
    )
    db.commit()

    response = client.get(
        "/patient-app/me/meetings",
        headers=_patient_auth_headers(patient),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["status"] == "waiting"
    assert payload["items"][0]["room_presence"]["patient_online"] is False

    db.refresh(meeting)
    assert meeting.status == MeetingStatus.waiting

    get_settings.cache_clear()
