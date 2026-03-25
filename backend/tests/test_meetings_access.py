from datetime import date, datetime, timezone
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import get_password_hash
from app.models.doctor_patient_assignment import DoctorPatientAssignment
from app.models.meeting import Meeting
from app.models.meeting_patient_invite_code import MeetingPatientInviteCode
from app.models.patient import Patient
from app.models.user import User, UserRole
from app.services.auth import create_login_response


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
        date_of_birth=date(1990, 1, 1),
    )
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


def _assign_patient(
    db: Session,
    *,
    doctor_id,
    patient_id,
    role: str = "primary",
) -> DoctorPatientAssignment:
    assignment = DoctorPatientAssignment(
        doctor_id=doctor_id,
        patient_id=patient_id,
        role=role,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return assignment


def _create_meeting(
    db: Session,
    *,
    doctor_id,
    patient_id,
    description: str,
) -> Meeting:
    meeting = Meeting(
        doctor_id=doctor_id,
        user_id=patient_id,
        date_time=datetime.now(timezone.utc),
        description=description,
    )
    db.add(meeting)
    db.commit()
    db.refresh(meeting)
    return meeting


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def test_doctor_list_meetings_shows_owner_and_assigned_patient_meetings(
    client: TestClient,
    db: Session,
):
    doctor_owner = _create_user(db, "doctor-owner@example.com", UserRole.doctor)
    doctor_other = _create_user(db, "doctor-other@example.com", UserRole.doctor)

    patient_assigned = _create_patient(db, "Assigned", "Patient")
    patient_unassigned = _create_patient(db, "Hidden", "Patient")
    _assign_patient(
        db,
        doctor_id=doctor_owner.id,
        patient_id=patient_assigned.id,
    )

    own_meeting = _create_meeting(
        db,
        doctor_id=doctor_owner.id,
        patient_id=patient_unassigned.id,
        description="Own meeting",
    )
    assigned_visible_meeting = _create_meeting(
        db,
        doctor_id=doctor_other.id,
        patient_id=patient_assigned.id,
        description="Assigned visible meeting",
    )
    hidden_meeting = _create_meeting(
        db,
        doctor_id=doctor_other.id,
        patient_id=patient_unassigned.id,
        description="Hidden meeting",
    )

    response = client.get("/meetings", headers=_auth_headers(doctor_owner))
    assert response.status_code == 200
    data = response.json()
    returned_ids = {item["id"] for item in data["items"]}

    assert str(own_meeting.id) in returned_ids
    assert str(assigned_visible_meeting.id) in returned_ids
    assert str(hidden_meeting.id) not in returned_ids
    assert data["total"] == 2


def test_doctor_can_read_assigned_non_owner_meeting_but_cannot_update_it(
    client: TestClient,
    db: Session,
):
    doctor_owner = _create_user(db, "doctor-read@example.com", UserRole.doctor)
    doctor_other = _create_user(db, "doctor-read-other@example.com", UserRole.doctor)
    patient = _create_patient(db, "Read", "Only")
    _assign_patient(db, doctor_id=doctor_owner.id, patient_id=patient.id)

    meeting = _create_meeting(
        db,
        doctor_id=doctor_other.id,
        patient_id=patient.id,
        description="Read-only for assigned doctor",
    )

    get_response = client.get(
        f"/meetings/{meeting.id}",
        headers=_auth_headers(doctor_owner),
    )
    assert get_response.status_code == 200

    update_response = client.put(
        f"/meetings/{meeting.id}",
        json={"description": "Updated by non-owner"},
        headers=_auth_headers(doctor_owner),
    )
    assert update_response.status_code == 403


def test_doctor_create_meeting_allows_any_patient_and_forces_doctor_id(
    client: TestClient,
    db: Session,
):
    doctor = _create_user(db, "doctor-create@example.com", UserRole.doctor)
    another_doctor = _create_user(db, "doctor-target@example.com", UserRole.doctor)
    patient_assigned = _create_patient(db, "Assigned", "Create")
    patient_unassigned = _create_patient(db, "Unassigned", "Create")
    _assign_patient(db, doctor_id=doctor.id, patient_id=patient_assigned.id)

    ok_response = client.post(
        "/meetings",
        json={
            "date_time": datetime.now(timezone.utc).isoformat(),
            "doctor_id": str(another_doctor.id),
            "user_id": str(patient_assigned.id),
            "description": "Should be created",
        },
        headers=_auth_headers(doctor),
    )
    assert ok_response.status_code == 201
    assert ok_response.json()["doctor_id"] == str(doctor.id)

    unassigned_response = client.post(
        "/meetings",
        json={
            "date_time": datetime.now(timezone.utc).isoformat(),
            "doctor_id": str(doctor.id),
            "user_id": str(patient_unassigned.id),
            "description": "Should be allowed",
        },
        headers=_auth_headers(doctor),
    )
    assert unassigned_response.status_code == 201
    assert unassigned_response.json()["doctor_id"] == str(doctor.id)


def test_doctor_create_meeting_eagerly_generates_patient_invite(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    monkeypatch.setenv("MEETING_PATIENT_JOIN_BASE_URL", "https://demo.trycloudflare.com")
    get_settings.cache_clear()

    doctor = _create_user(db, "doctor-eager-invite@example.com", UserRole.doctor)
    patient = _create_patient(db, "Eager", "Invite")

    response = client.post(
        "/meetings",
        json={
            "date_time": datetime.now(timezone.utc).isoformat(),
            "doctor_id": str(doctor.id),
            "user_id": str(patient.id),
            "description": "Generate invite immediately",
        },
        headers=_auth_headers(doctor),
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["patient_invite_url"].startswith("https://demo.trycloudflare.com/p/")

    meeting_id = UUID(payload["id"])
    invite_codes = db.scalars(
        select(MeetingPatientInviteCode)
        .where(MeetingPatientInviteCode.meeting_id == meeting_id)
        .order_by(MeetingPatientInviteCode.created_at.asc())
    ).all()
    assert len(invite_codes) == 1

    get_settings.cache_clear()


def test_doctor_can_update_own_meeting_to_unassigned_patient(
    client: TestClient,
    db: Session,
):
    doctor = _create_user(db, "doctor-update-own@example.com", UserRole.doctor)
    patient_initial = _create_patient(db, "Initial", "Patient")
    patient_unassigned = _create_patient(db, "Unassigned", "Patient")
    meeting = _create_meeting(
        db,
        doctor_id=doctor.id,
        patient_id=patient_initial.id,
        description="Update own meeting",
    )

    update_response = client.put(
        f"/meetings/{meeting.id}",
        json={
            "user_id": str(patient_unassigned.id),
            "description": "Updated to unassigned patient",
        },
        headers=_auth_headers(doctor),
    )

    assert update_response.status_code == 200
    assert update_response.json()["doctor_id"] == str(doctor.id)
    assert update_response.json()["user_id"] == str(patient_unassigned.id)


def test_doctor_update_meeting_rotates_patient_invite_when_patient_changes(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    monkeypatch.setenv("MEETING_PATIENT_JOIN_BASE_URL", "https://demo.trycloudflare.com")
    get_settings.cache_clear()

    doctor = _create_user(db, "doctor-rotate-invite@example.com", UserRole.doctor)
    patient_initial = _create_patient(db, "Initial", "Invite")
    patient_next = _create_patient(db, "Next", "Invite")

    create_response = client.post(
        "/meetings",
        json={
            "date_time": datetime.now(timezone.utc).isoformat(),
            "doctor_id": str(doctor.id),
            "user_id": str(patient_initial.id),
            "description": "Rotate invite after reassignment",
        },
        headers=_auth_headers(doctor),
    )
    assert create_response.status_code == 201
    created_payload = create_response.json()
    original_invite_url = created_payload["patient_invite_url"]
    meeting_id = UUID(created_payload["id"])

    update_response = client.put(
        f"/meetings/{meeting_id}",
        json={"user_id": str(patient_next.id)},
        headers=_auth_headers(doctor),
    )

    assert update_response.status_code == 200
    updated_payload = update_response.json()
    assert updated_payload["user_id"] == str(patient_next.id)
    assert updated_payload["patient_invite_url"].startswith("https://demo.trycloudflare.com/p/")
    assert updated_payload["patient_invite_url"] != original_invite_url

    invite_codes = db.scalars(
        select(MeetingPatientInviteCode)
        .where(MeetingPatientInviteCode.meeting_id == meeting_id)
        .order_by(MeetingPatientInviteCode.created_at.asc())
    ).all()
    assert len(invite_codes) == 2
    assert (
        sum(
            1
            for code in invite_codes
            if _as_utc(code.expires_at) > datetime.now(timezone.utc)
        )
        == 1
    )

    get_settings.cache_clear()


def test_medical_student_has_read_only_meeting_access(
    client: TestClient,
    db: Session,
):
    medical_student = _create_user(db, "medical-student-meetings@example.com", UserRole.medical_student)
    doctor = _create_user(db, "doctor-meeting-check@example.com", UserRole.doctor)
    patient_assigned = _create_patient(db, "Assigned", "Visible")
    patient_hidden = _create_patient(db, "Hidden", "Forbidden")
    _assign_patient(db, doctor_id=medical_student.id, patient_id=patient_assigned.id)

    visible_meeting = _create_meeting(
        db,
        doctor_id=doctor.id,
        patient_id=patient_assigned.id,
        description="Visible assigned meeting",
    )
    hidden_meeting = _create_meeting(
        db,
        doctor_id=doctor.id,
        patient_id=patient_hidden.id,
        description="Hidden unassigned meeting",
    )

    list_response = client.get("/meetings", headers=_auth_headers(medical_student))
    assert list_response.status_code == 200
    returned_ids = {item["id"] for item in list_response.json()["items"]}
    assert str(visible_meeting.id) in returned_ids
    assert str(hidden_meeting.id) not in returned_ids

    get_response = client.get(
        f"/meetings/{visible_meeting.id}",
        headers=_auth_headers(medical_student),
    )
    assert get_response.status_code == 200

    create_response = client.post(
        "/meetings",
        json={
            "date_time": datetime.now(timezone.utc).isoformat(),
            "doctor_id": str(doctor.id),
            "user_id": str(patient_assigned.id),
            "description": "No access",
        },
        headers=_auth_headers(medical_student),
    )
    assert create_response.status_code == 403

    update_response = client.put(
        f"/meetings/{visible_meeting.id}",
        json={"description": "No access"},
        headers=_auth_headers(medical_student),
    )
    assert update_response.status_code == 403


def test_admin_can_manage_all_meetings(
    client: TestClient,
    db: Session,
):
    admin = _create_user(db, "admin-meetings@example.com", UserRole.admin)
    doctor_a = _create_user(db, "doctor-a-admin@example.com", UserRole.doctor)
    doctor_b = _create_user(db, "doctor-b-admin@example.com", UserRole.doctor)
    patient_a = _create_patient(db, "Admin", "PatientA")
    patient_b = _create_patient(db, "Admin", "PatientB")

    meeting = _create_meeting(
        db,
        doctor_id=doctor_a.id,
        patient_id=patient_a.id,
        description="Admin can manage",
    )

    list_response = client.get("/meetings", headers=_auth_headers(admin))
    assert list_response.status_code == 200
    assert any(item["id"] == str(meeting.id) for item in list_response.json()["items"])

    update_response = client.put(
        f"/meetings/{meeting.id}",
        json={
            "doctor_id": str(doctor_b.id),
            "user_id": str(patient_b.id),
            "description": "Updated by admin",
        },
        headers=_auth_headers(admin),
    )
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["doctor_id"] == str(doctor_b.id)
    assert updated["user_id"] == str(patient_b.id)

    delete_response = client.delete(
        f"/meetings/{meeting.id}",
        headers=_auth_headers(admin),
    )
    assert delete_response.status_code == 204


def test_doctor_and_medical_student_stats_scope_matches_meetings_visibility(
    client: TestClient,
    db: Session,
):
    doctor = _create_user(db, "doctor-stats@example.com", UserRole.doctor)
    doctor_other = _create_user(db, "doctor-stats-other@example.com", UserRole.doctor)
    medical_student = _create_user(db, "medical-student-stats@example.com", UserRole.medical_student)

    patient_assigned = _create_patient(db, "Stats", "Assigned")
    patient_own = _create_patient(db, "Stats", "Own")
    patient_hidden = _create_patient(db, "Stats", "Hidden")
    _assign_patient(db, doctor_id=doctor.id, patient_id=patient_assigned.id)
    _assign_patient(
        db,
        doctor_id=medical_student.id,
        patient_id=patient_assigned.id,
        role="consulting",
    )

    _create_meeting(
        db,
        doctor_id=doctor.id,
        patient_id=patient_own.id,
        description="Own visible meeting",
    )
    _create_meeting(
        db,
        doctor_id=doctor_other.id,
        patient_id=patient_assigned.id,
        description="Assigned visible meeting",
    )
    _create_meeting(
        db,
        doctor_id=doctor_other.id,
        patient_id=patient_hidden.id,
        description="Hidden meeting",
    )

    current_year = datetime.now(timezone.utc).year
    doctor_stats = client.get(
        f"/stats/overview?year={current_year}",
        headers=_auth_headers(doctor),
    )
    assert doctor_stats.status_code == 200
    stats_data = doctor_stats.json()

    assert stats_data["totals"]["meetings"] == 2
    monthly_total = sum(item["consultations"] for item in stats_data["monthly"])
    assert monthly_total == 2

    medical_student_stats = client.get(
        f"/stats/overview?year={current_year}",
        headers=_auth_headers(medical_student),
    )
    assert medical_student_stats.status_code == 200
    medical_student_data = medical_student_stats.json()
    assert medical_student_data["totals"]["meetings"] == 1
    medical_student_monthly_total = sum(
        item["consultations"] for item in medical_student_data["monthly"]
    )
    assert medical_student_monthly_total == 1
