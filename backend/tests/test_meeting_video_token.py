from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import get_password_hash
from app.models.doctor_patient_assignment import DoctorPatientAssignment
from app.models.enums import MeetingStatus
from app.models.meeting import Meeting
from app.models.patient import Patient
from app.models.user import User, UserRole
from app.services import meeting_video as meeting_video_service
from app.services import zego_token
from app.services.auth import create_login_response


@pytest.fixture
def use_mock_video_provider(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MEETING_VIDEO_PROVIDER", "mock")
    monkeypatch.setenv("MEETING_VIDEO_TOKEN_TTL_SECONDS", "900")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


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


def _auth_headers(user: User) -> dict[str, str]:
    token = create_login_response(user)["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _create_patient(db: Session, first_name: str, last_name: str) -> Patient:
    patient = Patient(
        first_name=first_name,
        last_name=last_name,
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
    room: str | None = None,
) -> Meeting:
    meeting = Meeting(
        doctor_id=doctor_id,
        user_id=patient_id,
        date_time=datetime.now(timezone.utc),
        room=room,
    )
    db.add(meeting)
    db.commit()
    db.refresh(meeting)
    return meeting


def test_doctor_can_issue_video_token_for_visible_meeting(
    client: TestClient,
    db: Session,
    use_mock_video_provider,
):
    doctor = _create_user(db, "doctor-video-owner@example.com", UserRole.doctor)
    patient = _create_patient(db, "Video", "Owner")
    meeting = _create_meeting(db, doctor_id=doctor.id, patient_id=patient.id)

    response = client.post(
        f"/meetings/{meeting.id}/video/token",
        json={},
        headers=_auth_headers(doctor),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "mock"
    assert body["meeting_id"] == str(meeting.id)
    assert body["app_id"] is None
    assert body["room_id"].startswith("telemed_")
    assert body["user_id"] == meeting_video_service.derive_staff_participant_id(str(doctor.id))
    assert body["token"].startswith("mock.")


def test_doctor_cannot_issue_video_token_for_hidden_meeting(
    client: TestClient,
    db: Session,
    use_mock_video_provider,
):
    doctor_owner = _create_user(db, "doctor-video-visible@example.com", UserRole.doctor)
    doctor_other = _create_user(db, "doctor-video-hidden@example.com", UserRole.doctor)
    patient_visible = _create_patient(db, "Visible", "Patient")
    patient_hidden = _create_patient(db, "Hidden", "Patient")

    assignment = DoctorPatientAssignment(
        doctor_id=doctor_owner.id,
        patient_id=patient_visible.id,
        role="primary",
    )
    db.add(assignment)
    db.commit()

    visible_meeting = _create_meeting(
        db,
        doctor_id=doctor_other.id,
        patient_id=patient_visible.id,
    )
    hidden_meeting = _create_meeting(
        db,
        doctor_id=doctor_other.id,
        patient_id=patient_hidden.id,
    )

    visible_response = client.post(
        f"/meetings/{visible_meeting.id}/video/token",
        json={},
        headers=_auth_headers(doctor_owner),
    )
    assert visible_response.status_code == 200

    hidden_response = client.post(
        f"/meetings/{hidden_meeting.id}/video/token",
        json={},
        headers=_auth_headers(doctor_owner),
    )
    assert hidden_response.status_code == 403


def test_staff_cannot_issue_meeting_video_token(
    client: TestClient,
    db: Session,
    use_mock_video_provider,
):
    staff = _create_user(db, "staff-video@example.com", UserRole.staff)
    doctor = _create_user(db, "doctor-video-staff@example.com", UserRole.doctor)
    patient = _create_patient(db, "Staff", "Denied")
    meeting = _create_meeting(db, doctor_id=doctor.id, patient_id=patient.id)

    response = client.post(
        f"/meetings/{meeting.id}/video/token",
        json={},
        headers=_auth_headers(staff),
    )
    assert response.status_code == 403


def test_video_token_returns_503_when_provider_disabled(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("MEETING_VIDEO_PROVIDER", "disabled")
    get_settings.cache_clear()

    doctor = _create_user(db, "doctor-video-disabled@example.com", UserRole.doctor)
    patient = _create_patient(db, "Disabled", "Provider")
    meeting = _create_meeting(db, doctor_id=doctor.id, patient_id=patient.id)

    response = client.post(
        f"/meetings/{meeting.id}/video/token",
        json={},
        headers=_auth_headers(doctor),
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Meeting video provider is disabled."
    get_settings.cache_clear()


def test_zego_provider_uses_generate_token04(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("MEETING_VIDEO_PROVIDER", "zego")
    monkeypatch.setenv("ZEGO_APP_ID", "1477525628")
    monkeypatch.setenv("ZEGO_SERVER_SECRET", "92010c8a7aa686718d08b4ff247e462f")
    get_settings.cache_clear()
    monkeypatch.setattr(zego_token, "generate_token04", lambda **_kwargs: "04.mock.zego")

    doctor = _create_user(db, "doctor-video-zego@example.com", UserRole.doctor)
    patient = _create_patient(db, "Zego", "Provider")
    meeting = _create_meeting(db, doctor_id=doctor.id, patient_id=patient.id)

    response = client.post(
        f"/meetings/{meeting.id}/video/token",
        json={},
        headers=_auth_headers(doctor),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "zego"
    assert body["app_id"] == 1477525628
    assert body["token"] == "04.mock.zego"

    get_settings.cache_clear()


def test_doctor_can_create_patient_invite_and_exchange_video_token(
    client: TestClient,
    db: Session,
    use_mock_video_provider,
):
    doctor = _create_user(db, "doctor-video-patient-invite@example.com", UserRole.doctor)
    patient = _create_patient(db, "Invite", "Patient")
    meeting = _create_meeting(db, doctor_id=doctor.id, patient_id=patient.id)

    invite_response = client.post(
        f"/meetings/{meeting.id}/video/patient-invite",
        json={},
        headers=_auth_headers(doctor),
    )
    assert invite_response.status_code == 200
    invite_body = invite_response.json()
    assert invite_body["meeting_id"] == str(meeting.id)
    assert invite_body["invite_token"].startswith("pjoin.")
    assert len(invite_body["short_code"]) >= 6
    assert "invite_url" in invite_body
    assert "/p/" in invite_body["invite_url"]
    assert "?t=" not in invite_body["invite_url"]
    assert "meeting_id=" not in invite_body["invite_url"]

    token_response = client.post(
        "/meetings/video/patient/token",
        json={
            "invite_token": invite_body["invite_token"],
        },
    )
    assert token_response.status_code == 200
    token_body = token_response.json()
    assert token_body["provider"] == "mock"
    assert token_body["meeting_id"] == str(meeting.id)
    assert token_body["app_id"] is None
    assert token_body["room_id"] == meeting_video_service.derive_room_id(meeting)
    assert token_body["user_id"] == meeting_video_service.derive_patient_participant_id(str(patient.id))
    assert token_body["token"].startswith("mock.")
    db.refresh(meeting)
    assert meeting.status == MeetingStatus.waiting


def test_patient_token_rejects_tampered_invite(
    client: TestClient,
    db: Session,
    use_mock_video_provider,
):
    doctor = _create_user(db, "doctor-video-patient-invalid@example.com", UserRole.doctor)
    patient = _create_patient(db, "Invalid", "Invite")
    meeting = _create_meeting(db, doctor_id=doctor.id, patient_id=patient.id)

    invite_response = client.post(
        f"/meetings/{meeting.id}/video/patient-invite",
        json={},
        headers=_auth_headers(doctor),
    )
    assert invite_response.status_code == 200
    invite_token = invite_response.json()["invite_token"]
    tampered = f"{invite_token}x"

    token_response = client.post(
        "/meetings/video/patient/token",
        json={
            "meeting_id": str(meeting.id),
            "invite_token": tampered,
        },
    )
    assert token_response.status_code == 401


def test_patient_can_exchange_video_token_via_short_code(
    client: TestClient,
    db: Session,
    use_mock_video_provider,
):
    doctor = _create_user(db, "doctor-video-patient-short@example.com", UserRole.doctor)
    patient = _create_patient(db, "Short", "Code")
    meeting = _create_meeting(db, doctor_id=doctor.id, patient_id=patient.id)

    invite_response = client.post(
        f"/meetings/{meeting.id}/video/patient-invite",
        json={},
        headers=_auth_headers(doctor),
    )
    assert invite_response.status_code == 200
    short_code = invite_response.json()["short_code"]

    token_response = client.post(
        "/meetings/video/patient/token",
        json={"short_code": short_code},
    )
    assert token_response.status_code == 200
    token_body = token_response.json()
    assert token_body["provider"] == "mock"
    assert token_body["meeting_id"] == str(meeting.id)
    assert token_body["room_id"] == meeting_video_service.derive_room_id(meeting)
    assert token_body["user_id"] == meeting_video_service.derive_patient_participant_id(str(patient.id))
    db.refresh(meeting)
    assert meeting.status == MeetingStatus.waiting


def test_doctor_token_promotes_waiting_meeting_to_in_progress(
    client: TestClient,
    db: Session,
    use_mock_video_provider,
):
    doctor = _create_user(db, "doctor-video-promote@example.com", UserRole.doctor)
    patient = _create_patient(db, "Promote", "Status")
    meeting = _create_meeting(db, doctor_id=doctor.id, patient_id=patient.id)

    invite_response = client.post(
        f"/meetings/{meeting.id}/video/patient-invite",
        json={},
        headers=_auth_headers(doctor),
    )
    assert invite_response.status_code == 200

    patient_token_response = client.post(
        "/meetings/video/patient/token",
        json={"invite_token": invite_response.json()["invite_token"]},
    )
    assert patient_token_response.status_code == 200
    db.refresh(meeting)
    assert meeting.status == MeetingStatus.waiting

    doctor_token_response = client.post(
        f"/meetings/{meeting.id}/video/token",
        json={},
        headers=_auth_headers(doctor),
    )
    assert doctor_token_response.status_code == 200
    db.refresh(meeting)
    assert meeting.status == MeetingStatus.in_progress


def test_staff_cannot_create_patient_invite(
    client: TestClient,
    db: Session,
    use_mock_video_provider,
):
    staff = _create_user(db, "staff-video-patient-invite@example.com", UserRole.staff)
    doctor = _create_user(db, "doctor-video-owner2@example.com", UserRole.doctor)
    patient = _create_patient(db, "Staff", "Blocked")
    meeting = _create_meeting(db, doctor_id=doctor.id, patient_id=patient.id)

    response = client.post(
        f"/meetings/{meeting.id}/video/patient-invite",
        json={},
        headers=_auth_headers(staff),
    )
    assert response.status_code == 403


def test_doctor_leave_presence_marks_patient_waiting_again(
    client: TestClient,
    db: Session,
    use_mock_video_provider,
):
    doctor = _create_user(db, "doctor-presence-leave@example.com", UserRole.doctor)
    patient = _create_patient(db, "Presence", "Leave")
    meeting = _create_meeting(db, doctor_id=doctor.id, patient_id=patient.id)

    invite_response = client.post(
        f"/meetings/{meeting.id}/video/patient-invite",
        json={},
        headers=_auth_headers(doctor),
    )
    assert invite_response.status_code == 200
    invite_payload = invite_response.json()

    patient_token_response = client.post(
        "/meetings/video/patient/token",
        json={"invite_token": invite_payload["invite_token"]},
    )
    assert patient_token_response.status_code == 200

    doctor_token_response = client.post(
        f"/meetings/{meeting.id}/video/token",
        json={},
        headers=_auth_headers(doctor),
    )
    assert doctor_token_response.status_code == 200
    db.refresh(meeting)
    assert meeting.status == MeetingStatus.in_progress

    leave_response = client.post(
        f"/meetings/{meeting.id}/video/presence/leave",
        json={},
        headers=_auth_headers(doctor),
    )
    assert leave_response.status_code == 200
    leave_body = leave_response.json()
    assert leave_body["state"] == "doctor_left_patient_waiting"
    assert leave_body["doctor_online"] is False
    assert leave_body["patient_online"] is True

    db.refresh(meeting)
    assert meeting.status == MeetingStatus.waiting
