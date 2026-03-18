from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import get_password_hash
from app.models.doctor_patient_assignment import DoctorPatientAssignment
from app.models.enums import MeetingStatus
from app.models.meeting import Meeting
from app.models.meeting_room_presence import MeetingRoomPresence
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


def _set_room_presence(
    db: Session,
    meeting: Meeting,
    *,
    mode: str,
) -> MeetingRoomPresence:
    now = datetime.now(timezone.utc)
    stale = now - timedelta(minutes=2)

    presence = db.get(MeetingRoomPresence, meeting.id)
    if presence is None:
        presence = MeetingRoomPresence(meeting_id=meeting.id)

    if mode == "both_online":
        presence.doctor_last_seen_at = now
        presence.doctor_left_at = None
        presence.patient_last_seen_at = now
        presence.patient_left_at = None
    elif mode == "patient_only":
        presence.doctor_last_seen_at = stale
        presence.doctor_left_at = now
        presence.patient_last_seen_at = now
        presence.patient_left_at = None
    elif mode == "doctor_only":
        presence.doctor_last_seen_at = now
        presence.doctor_left_at = None
        presence.patient_last_seen_at = stale
        presence.patient_left_at = now
    elif mode == "none_online":
        presence.doctor_last_seen_at = stale
        presence.doctor_left_at = now
        presence.patient_last_seen_at = stale
        presence.patient_left_at = now
    else:
        raise ValueError(f"Unsupported presence mode: {mode}")

    if presence.doctor_last_seen_at and presence.doctor_joined_at is None:
        presence.doctor_joined_at = presence.doctor_last_seen_at
    if presence.patient_last_seen_at and presence.patient_joined_at is None:
        presence.patient_joined_at = presence.patient_last_seen_at

    presence.refreshed_at = now
    db.add(presence)
    db.commit()
    db.refresh(presence)
    return presence


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
    db.refresh(meeting)
    assert meeting.status == MeetingStatus.scheduled
    assert meeting.room_presence is None


@pytest.mark.meeting_presence_regression
@pytest.mark.parametrize(
    ("initial_status", "presence_mode", "expected_status", "expected_presence_state"),
    [
        (MeetingStatus.scheduled, "patient_only", MeetingStatus.waiting, "doctor_left_patient_waiting"),
        (MeetingStatus.scheduled, "both_online", MeetingStatus.in_progress, "both_in_room"),
        (MeetingStatus.waiting, "none_online", MeetingStatus.scheduled, "none"),
        (MeetingStatus.waiting, "both_online", MeetingStatus.in_progress, "both_in_room"),
        (MeetingStatus.in_progress, "patient_only", MeetingStatus.waiting, "doctor_left_patient_waiting"),
        (MeetingStatus.in_progress, "doctor_only", MeetingStatus.scheduled, "doctor_only"),
        (MeetingStatus.in_progress, "none_online", MeetingStatus.scheduled, "none"),
    ],
)
def test_get_meeting_reconciles_active_status_from_presence(
    client: TestClient,
    db: Session,
    use_mock_video_provider,
    initial_status: MeetingStatus,
    presence_mode: str,
    expected_status: MeetingStatus,
    expected_presence_state: str,
):
    doctor = _create_user(
        db,
        f"doctor-detail-{initial_status.value}-{presence_mode}@example.com",
        UserRole.doctor,
    )
    patient = _create_patient(db, "Detail", f"{initial_status.value}-{presence_mode}")
    meeting = _create_meeting(db, doctor_id=doctor.id, patient_id=patient.id)
    meeting.status = initial_status
    db.add(meeting)
    db.commit()
    db.refresh(meeting)

    _set_room_presence(db, meeting, mode=presence_mode)

    response = client.get(
        f"/meetings/{meeting.id}",
        headers=_auth_headers(doctor),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == expected_status.value
    assert body["room_presence"]["state"] == expected_presence_state

    db.refresh(meeting)
    assert meeting.status == expected_status


@pytest.mark.meeting_presence_regression
@pytest.mark.parametrize(
    ("initial_status", "presence_mode", "expected_status", "expected_presence_state"),
    [
        (MeetingStatus.scheduled, "patient_only", MeetingStatus.waiting, "doctor_left_patient_waiting"),
        (MeetingStatus.scheduled, "both_online", MeetingStatus.in_progress, "both_in_room"),
        (MeetingStatus.waiting, "none_online", MeetingStatus.scheduled, "none"),
        (MeetingStatus.waiting, "both_online", MeetingStatus.in_progress, "both_in_room"),
        (MeetingStatus.in_progress, "patient_only", MeetingStatus.waiting, "doctor_left_patient_waiting"),
        (MeetingStatus.in_progress, "doctor_only", MeetingStatus.scheduled, "doctor_only"),
        (MeetingStatus.in_progress, "none_online", MeetingStatus.scheduled, "none"),
    ],
)
def test_list_meetings_reconciles_active_status_from_presence(
    client: TestClient,
    db: Session,
    use_mock_video_provider,
    initial_status: MeetingStatus,
    presence_mode: str,
    expected_status: MeetingStatus,
    expected_presence_state: str,
):
    doctor = _create_user(
        db,
        f"doctor-list-{initial_status.value}-{presence_mode}@example.com",
        UserRole.doctor,
    )
    patient = _create_patient(db, "List", f"{initial_status.value}-{presence_mode}")
    meeting = _create_meeting(db, doctor_id=doctor.id, patient_id=patient.id)
    meeting.status = initial_status
    db.add(meeting)
    db.commit()
    db.refresh(meeting)

    _set_room_presence(db, meeting, mode=presence_mode)

    response = client.get(
        "/meetings?page=1&limit=20",
        headers=_auth_headers(doctor),
    )

    assert response.status_code == 200
    body = response.json()
    target = next(item for item in body["items"] if item["id"] == str(meeting.id))
    assert target["status"] == expected_status.value
    assert target["room_presence"]["state"] == expected_presence_state

    db.refresh(meeting)
    assert meeting.status == expected_status


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


@pytest.mark.meeting_presence_regression
def test_reliability_snapshot_reconciles_status_and_reports_staleness(
    client: TestClient,
    db: Session,
    use_mock_video_provider,
):
    doctor = _create_user(db, "doctor-reliability@example.com", UserRole.doctor)
    patient = _create_patient(db, "Reliability", "Snapshot")
    meeting = _create_meeting(db, doctor_id=doctor.id, patient_id=patient.id)
    meeting.status = MeetingStatus.in_progress
    db.add(meeting)
    db.commit()
    db.refresh(meeting)

    stale_time = datetime.now(timezone.utc) - timedelta(minutes=2)
    db.add(
        MeetingRoomPresence(
            meeting_id=meeting.id,
            doctor_last_seen_at=stale_time,
            doctor_left_at=None,
            patient_last_seen_at=stale_time,
            patient_left_at=None,
            refreshed_at=stale_time,
        )
    )
    db.commit()

    response = client.get(
        f"/meetings/{meeting.id}/video/reliability",
        headers=_auth_headers(doctor),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["meeting_id"] == str(meeting.id)
    assert body["meeting_status_before_reconcile"] == "in_progress"
    assert body["meeting_status"] == "scheduled"
    assert body["meeting_status_reconciled"] is True
    assert body["active_status_projection"] == "scheduled"
    assert body["status_in_sync"] is True
    assert body["room_presence_state"] == "none"
    assert body["doctor_online"] is False
    assert body["patient_online"] is False
    assert body["doctor_presence_stale"] is True
    assert body["patient_presence_stale"] is True
    assert body["doctor_last_seen_age_seconds"] >= 100
    assert body["patient_last_seen_age_seconds"] >= 100
    assert body["heartbeat_timeout_seconds"] == 25

    db.refresh(meeting)
    assert meeting.status == MeetingStatus.scheduled


def test_hidden_doctor_cannot_view_reliability_snapshot(
    client: TestClient,
    db: Session,
    use_mock_video_provider,
):
    doctor_owner = _create_user(db, "doctor-reliability-owner@example.com", UserRole.doctor)
    doctor_other = _create_user(db, "doctor-reliability-other@example.com", UserRole.doctor)
    patient = _create_patient(db, "Reliability", "Denied")
    meeting = _create_meeting(db, doctor_id=doctor_other.id, patient_id=patient.id)

    response = client.get(
        f"/meetings/{meeting.id}/video/reliability",
        headers=_auth_headers(doctor_owner),
    )

    assert response.status_code == 403


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
    assert meeting.status == MeetingStatus.scheduled
    assert meeting.room_presence is None


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


@pytest.mark.meeting_presence_regression
def test_patient_presence_heartbeat_rejects_expired_invite_token(
    client: TestClient,
    db: Session,
    use_mock_video_provider,
):
    doctor = _create_user(db, "doctor-video-patient-expired-heartbeat@example.com", UserRole.doctor)
    patient = _create_patient(db, "Expired", "Heartbeat")
    meeting = _create_meeting(db, doctor_id=doctor.id, patient_id=patient.id)

    expired_token = meeting_video_service._build_patient_invite_token(
        meeting_id=str(meeting.id),
        patient_id=str(meeting.user_id),
        room_id=meeting_video_service.derive_room_id(meeting),
        expires_at_unix=int((datetime.now(timezone.utc) - timedelta(minutes=5)).timestamp()),
    )

    response = client.post(
        "/meetings/video/patient/presence/heartbeat",
        json={"invite_token": expired_token},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Patient invite token expired."


@pytest.mark.meeting_presence_regression
def test_patient_presence_heartbeat_rejects_invite_token_meeting_id_mismatch(
    client: TestClient,
    db: Session,
    use_mock_video_provider,
):
    doctor = _create_user(db, "doctor-video-patient-presence-mismatch@example.com", UserRole.doctor)
    patient = _create_patient(db, "Presence", "Mismatch")
    primary_meeting = _create_meeting(db, doctor_id=doctor.id, patient_id=patient.id)
    other_meeting = _create_meeting(db, doctor_id=doctor.id, patient_id=patient.id)

    invite_response = client.post(
        f"/meetings/{primary_meeting.id}/video/patient-invite",
        json={},
        headers=_auth_headers(doctor),
    )
    assert invite_response.status_code == 200

    response = client.post(
        "/meetings/video/patient/presence/heartbeat",
        json={
            "meeting_id": str(other_meeting.id),
            "invite_token": invite_response.json()["invite_token"],
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Patient invite token does not match meeting_id."


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
    assert meeting.status == MeetingStatus.scheduled
    assert meeting.room_presence is None


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
    assert meeting.status == MeetingStatus.scheduled

    patient_heartbeat_response = client.post(
        "/meetings/video/patient/presence/heartbeat",
        json={"invite_token": invite_response.json()["invite_token"]},
    )
    assert patient_heartbeat_response.status_code == 200
    db.refresh(meeting)
    assert meeting.status == MeetingStatus.waiting

    doctor_token_response = client.post(
        f"/meetings/{meeting.id}/video/token",
        json={},
        headers=_auth_headers(doctor),
    )
    assert doctor_token_response.status_code == 200
    db.refresh(meeting)
    assert meeting.status == MeetingStatus.waiting

    doctor_heartbeat_response = client.post(
        f"/meetings/{meeting.id}/video/presence/heartbeat",
        json={},
        headers=_auth_headers(doctor),
    )
    assert doctor_heartbeat_response.status_code == 200
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


@pytest.mark.meeting_presence_regression
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

    patient_heartbeat_response = client.post(
        "/meetings/video/patient/presence/heartbeat",
        json={"invite_token": invite_payload["invite_token"]},
    )
    assert patient_heartbeat_response.status_code == 200

    doctor_token_response = client.post(
        f"/meetings/{meeting.id}/video/token",
        json={},
        headers=_auth_headers(doctor),
    )
    assert doctor_token_response.status_code == 200

    doctor_heartbeat_response = client.post(
        f"/meetings/{meeting.id}/video/presence/heartbeat",
        json={},
        headers=_auth_headers(doctor),
    )
    assert doctor_heartbeat_response.status_code == 200
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


@pytest.mark.meeting_presence_regression
def test_patient_leave_presence_resets_waiting_status_when_doctor_not_online(
    client: TestClient,
    db: Session,
    use_mock_video_provider,
):
    doctor = _create_user(db, "doctor-patient-leave-reset@example.com", UserRole.doctor)
    patient = _create_patient(db, "Patient", "LeaveReset")
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

    patient_heartbeat_response = client.post(
        "/meetings/video/patient/presence/heartbeat",
        json={"invite_token": invite_payload["invite_token"]},
    )
    assert patient_heartbeat_response.status_code == 200
    db.refresh(meeting)
    assert meeting.status == MeetingStatus.waiting

    leave_response = client.post(
        "/meetings/video/patient/presence/leave",
        json={"invite_token": invite_payload["invite_token"]},
    )
    assert leave_response.status_code == 200
    leave_body = leave_response.json()
    assert leave_body["state"] == "none"
    assert leave_body["patient_online"] is False
    assert leave_body["refreshed_at"] is not None

    db.refresh(meeting)
    assert meeting.status == MeetingStatus.scheduled


@pytest.mark.meeting_presence_regression
def test_patient_leave_presence_resets_in_progress_status_when_doctor_stays_online(
    client: TestClient,
    db: Session,
    use_mock_video_provider,
):
    doctor = _create_user(db, "doctor-patient-leave-in-progress@example.com", UserRole.doctor)
    patient = _create_patient(db, "Patient", "LeaveInProgress")
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

    patient_heartbeat_response = client.post(
        "/meetings/video/patient/presence/heartbeat",
        json={"invite_token": invite_payload["invite_token"]},
    )
    assert patient_heartbeat_response.status_code == 200

    doctor_token_response = client.post(
        f"/meetings/{meeting.id}/video/token",
        json={},
        headers=_auth_headers(doctor),
    )
    assert doctor_token_response.status_code == 200

    doctor_heartbeat_response = client.post(
        f"/meetings/{meeting.id}/video/presence/heartbeat",
        json={},
        headers=_auth_headers(doctor),
    )
    assert doctor_heartbeat_response.status_code == 200
    db.refresh(meeting)
    assert meeting.status == MeetingStatus.in_progress

    leave_response = client.post(
        "/meetings/video/patient/presence/leave",
        json={"invite_token": invite_payload["invite_token"]},
    )
    assert leave_response.status_code == 200
    leave_body = leave_response.json()
    assert leave_body["state"] == "doctor_only"
    assert leave_body["patient_online"] is False
    assert leave_body["doctor_online"] is True

    db.refresh(meeting)
    assert meeting.status == MeetingStatus.scheduled


@pytest.mark.meeting_presence_regression
def test_list_meetings_prunes_stale_waiting_presence(
    client: TestClient,
    db: Session,
    use_mock_video_provider,
):
    doctor = _create_user(db, "doctor-presence-prune@example.com", UserRole.doctor)
    patient = _create_patient(db, "Presence", "Prune")
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

    patient_heartbeat_response = client.post(
        "/meetings/video/patient/presence/heartbeat",
        json={"invite_token": invite_payload["invite_token"]},
    )
    assert patient_heartbeat_response.status_code == 200

    db.refresh(meeting)
    presence = meeting.room_presence
    assert presence is not None
    stale_time = datetime.now(timezone.utc) - timedelta(minutes=2)
    presence.patient_last_seen_at = stale_time
    presence.patient_left_at = None
    presence.refreshed_at = stale_time
    db.add(presence)
    db.commit()

    list_response = client.get(
        "/meetings?page=1&limit=20",
        headers=_auth_headers(doctor),
    )
    assert list_response.status_code == 200

    db.refresh(meeting)
    assert meeting.status == MeetingStatus.scheduled


@pytest.mark.meeting_presence_regression
def test_list_meetings_reconciles_stale_in_progress_presence(
    client: TestClient,
    db: Session,
    use_mock_video_provider,
):
    doctor = _create_user(db, "doctor-presence-stale-in-progress@example.com", UserRole.doctor)
    patient = _create_patient(db, "Presence", "StaleInProgress")
    meeting = _create_meeting(db, doctor_id=doctor.id, patient_id=patient.id)
    meeting.status = MeetingStatus.in_progress
    db.add(meeting)

    stale_time = datetime.now(timezone.utc) - timedelta(minutes=2)
    db.add(
        MeetingRoomPresence(
            meeting_id=meeting.id,
            patient_last_seen_at=stale_time,
            patient_left_at=None,
            doctor_last_seen_at=None,
            doctor_left_at=None,
            refreshed_at=stale_time,
        )
    )
    db.commit()

    list_response = client.get(
        "/meetings?page=1&limit=20",
        headers=_auth_headers(doctor),
    )
    assert list_response.status_code == 200

    db.refresh(meeting)
    assert meeting.status == MeetingStatus.scheduled
