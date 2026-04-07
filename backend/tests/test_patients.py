from types import SimpleNamespace
from datetime import date, datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import BackgroundTasks
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models.audit_log import AuditLog
from app.models.doctor_patient_assignment import DoctorPatientAssignment
from app.models.heart_sound_record import HeartSoundRecord
from app.models.patient import Patient
from app.models.pressure_record import PressureRecord
from app.models.user import User, UserRole
from app.schemas.patient import PatientCreate
from app.api.patients import notify_care_team
from app.services.auth import create_login_response
from app.services.patient import create_patient, get_patient, list_patients


def create_test_user(db: Session, role: UserRole = UserRole.medical_student) -> User:
    user = User(
        email=f"test_{uuid4()}@example.com",
        password_hash=get_password_hash("password"),
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_auth_headers(user: User) -> dict:
    token_response = create_login_response(user)
    return {"Authorization": f"Bearer {token_response['access_token']}"}


def assign_doctor_to_patient(db: Session, doctor_id, patient_id, role: str = "primary") -> DoctorPatientAssignment:
    doctor_uuid = doctor_id if isinstance(doctor_id, UUID) else UUID(str(doctor_id))
    patient_uuid = patient_id if isinstance(patient_id, UUID) else UUID(str(patient_id))
    assignment = DoctorPatientAssignment(
        doctor_id=doctor_uuid,
        patient_id=patient_uuid,
        role=role,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return assignment


def test_create_patient(db: Session):
    patient_data = PatientCreate(
        first_name="John",
        last_name="Doe",
        date_of_birth=date(1990, 1, 1),
        gender="Male",
        phone="+1234567890",
        email="john.doe@example.com",
    )

    patient = create_patient(db, patient_data)

    assert patient.first_name == "John"
    assert patient.last_name == "Doe"
    assert patient.email == "john.doe@example.com"
    assert patient.id is not None


def test_get_patient(db: Session):
    patient_data = PatientCreate(
        first_name="Jane",
        last_name="Smith",
        date_of_birth=date(1985, 5, 15),
    )
    created_patient = create_patient(db, patient_data)

    retrieved_patient = get_patient(db, str(created_patient.id))

    assert retrieved_patient is not None
    assert retrieved_patient.id == created_patient.id
    assert retrieved_patient.first_name == "Jane"


def test_list_patients(db: Session):
    for i in range(5):
        patient_data = PatientCreate(
            first_name=f"Patient{i}",
            last_name=f"Test{i}",
            date_of_birth=date(1980 + i, 1, 1),
        )
        create_patient(db, patient_data)

    patients, total = list_patients(db, page=1, limit=3, q=None, sort="created_at", order="desc")

    assert len(patients) == 3
    assert total == 5


def test_list_patients_matches_full_name_query_with_pasted_spacing(db: Session):
    patient = create_patient(
        db,
        PatientCreate(
            first_name="Papon",
            last_name="Moonkonburee",
            date_of_birth=date(1991, 1, 1),
            email="papon@example.com",
        ),
    )

    patients, total = list_patients(
        db,
        page=1,
        limit=10,
        q="  papon   moonkonburee  ",
        sort="created_at",
        order="desc",
    )

    assert total == 1
    assert len(patients) == 1
    assert patients[0].id == patient.id


def test_list_patients_ignores_invisible_characters_in_pasted_query(db: Session):
    patient = create_patient(
        db,
        PatientCreate(
            first_name="Papon",
            last_name="Moonkonburee",
            date_of_birth=date(1991, 1, 1),
            email="papon@example.com",
        ),
    )

    patients, total = list_patients(
        db,
        page=1,
        limit=10,
        q="papon\u200b moonkonburee",
        sort="created_at",
        order="desc",
    )

    assert total == 1
    assert len(patients) == 1
    assert patients[0].id == patient.id


def test_list_patients_does_not_match_email_or_phone_queries(db: Session):
    create_patient(
        db,
        PatientCreate(
            first_name="Safe",
            last_name="Search",
            date_of_birth=date(1991, 1, 1),
            email="safe.search@example.com",
            phone="+66123456789",
        ),
    )

    email_matches, email_total = list_patients(
        db,
        page=1,
        limit=10,
        q="safe.search@example.com",
        sort="created_at",
        order="desc",
    )
    phone_matches, phone_total = list_patients(
        db,
        page=1,
        limit=10,
        q="123456789",
        sort="created_at",
        order="desc",
    )

    assert email_total == 0
    assert email_matches == []
    assert phone_total == 0
    assert phone_matches == []


def test_patient_api_endpoints(client: TestClient, db: Session):
    doctor = create_test_user(db, UserRole.doctor)
    admin = create_test_user(db, UserRole.admin)
    headers = get_auth_headers(doctor)
    admin_headers = get_auth_headers(admin)

    patient_data = {
        "first_name": "API",
        "last_name": "Test",
        "date_of_birth": "1992-06-15",
        "email": "api.test@example.com",
    }

    response = client.post("/patients", json=patient_data, headers=headers)
    assert response.status_code == 201
    created_patient = response.json()
    patient_id = created_patient["id"]

    response = client.get(f"/patients/{patient_id}", headers=headers)
    assert response.status_code == 200
    assert response.json()["first_name"] == "API"
    assert "phone" not in response.json()
    assert "email" not in response.json()
    assert "address" not in response.json()

    response = client.get("/patients", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert "total" in data

    response = client.put(f"/patients/{patient_id}", json={"first_name": "Updated"}, headers=headers)
    assert response.status_code == 200
    assert response.json()["first_name"] == "Updated"

    response = client.delete(f"/patients/{patient_id}", headers=admin_headers)
    assert response.status_code == 204


def test_notify_care_team_targets_only_assigned_doctors_and_admins(db: Session, monkeypatch):
    admin = create_test_user(db, UserRole.admin)
    current_doctor = create_test_user(db, UserRole.doctor)
    assigned_peer = create_test_user(db, UserRole.doctor)
    unassigned_doctor = create_test_user(db, UserRole.doctor)
    patient = create_patient(
        db,
        PatientCreate(
            first_name="Notify",
            last_name="Scope",
            date_of_birth=date(1993, 3, 3),
        ),
    )

    assign_doctor_to_patient(db, current_doctor.id, patient.id)
    assign_doctor_to_patient(db, assigned_peer.id, patient.id, role="consulting")

    monkeypatch.setattr(
        "app.core.config.get_settings",
        lambda: SimpleNamespace(novu_enabled=True),
    )

    captured: dict[str, list[str] | str] = {}

    def fake_notify(user_ids: list[str], patient_id: str, actor_user_id: str):
        captured["user_ids"] = user_ids
        captured["patient_id"] = patient_id
        captured["actor_user_id"] = actor_user_id

    monkeypatch.setattr("app.services.novu.notify_patient_updated", fake_notify)

    background_tasks = BackgroundTasks()
    notify_care_team(db, current_doctor, background_tasks, "updated", str(patient.id))

    assert len(background_tasks.tasks) == 1

    task = background_tasks.tasks[0]
    task.func()

    recipients = set(captured["user_ids"])
    assert recipients == {str(admin.id), str(assigned_peer.id)}
    assert str(current_doctor.id) not in recipients
    assert str(unassigned_doctor.id) not in recipients
    assert captured["patient_id"] == str(patient.id)
    assert captured["actor_user_id"] == str(current_doctor.id)


def test_patient_list_response_omits_contact_fields(client: TestClient, db: Session):
    admin = create_test_user(db, UserRole.admin)
    headers = get_auth_headers(admin)

    create_response = client.post(
        "/patients",
        json={
            "first_name": "Hidden",
            "last_name": "Contact",
            "date_of_birth": "1992-06-15",
            "phone": "+66123456789",
            "email": "hidden.contact@example.com",
            "address": "123 Privacy Lane",
        },
        headers=headers,
    )
    assert create_response.status_code == 201
    patient_id = create_response.json()["id"]

    list_response = client.get("/patients", headers=headers)
    assert list_response.status_code == 200
    item = next(entry for entry in list_response.json()["items"] if entry["id"] == patient_id)

    assert "phone" not in item
    assert "email" not in item
    assert "address" not in item


def test_patient_contact_endpoint_reveals_details_and_writes_audit(client: TestClient, db: Session):
    admin = create_test_user(db, UserRole.admin)
    headers = get_auth_headers(admin)

    create_response = client.post(
        "/patients",
        json={
            "first_name": "Reveal",
            "last_name": "Contact",
            "date_of_birth": "1992-06-15",
            "phone": "+66123456789",
            "email": "reveal.contact@example.com",
            "address": "123 Privacy Lane",
        },
        headers=headers,
    )
    assert create_response.status_code == 201
    patient_id = create_response.json()["id"]

    contact_response = client.get(f"/patients/{patient_id}/contact", headers=headers)
    assert contact_response.status_code == 200
    payload = contact_response.json()
    assert payload["phone"] == "+66123456789"
    assert payload["email"] == "reveal.contact@example.com"
    assert payload["address"] == "123 Privacy Lane"

    audit_entry = db.scalar(
        select(AuditLog).where(
            AuditLog.user_id == admin.id,
            AuditLog.action == "patient_contact_revealed",
            AuditLog.resource_id == UUID(patient_id),
        )
    )
    assert audit_entry is not None


def test_patient_contact_endpoint_allows_stale_session(client: TestClient, db: Session):
    admin = create_test_user(db, UserRole.admin)
    patient = create_patient(
        db,
        PatientCreate(
            first_name="Stale",
            last_name="Session",
            date_of_birth=date(1990, 1, 1),
            phone="+66123456789",
        ),
    )

    stale_response = create_login_response(
        admin,
        db=db,
        mfa_verified=True,
        mfa_authenticated_at=datetime.now(timezone.utc) - timedelta(hours=5),
    )
    response = client.get(
        f"/patients/{patient.id}/contact",
        headers={"Authorization": f"Bearer {stale_response['access_token']}"},
    )

    assert response.status_code == 200
    assert response.json()["phone"] == "+66123456789"


def test_patient_contact_endpoint_accepts_recent_session_within_four_hours(client: TestClient, db: Session):
    admin = create_test_user(db, UserRole.admin)
    patient = create_patient(
        db,
        PatientCreate(
            first_name="Recent",
            last_name="Window",
            date_of_birth=date(1990, 1, 1),
            phone="+66123456789",
        ),
    )

    recent_response = create_login_response(
        admin,
        db=db,
        mfa_verified=True,
        mfa_authenticated_at=datetime.now(timezone.utc) - timedelta(hours=3),
    )
    response = client.get(
        f"/patients/{patient.id}/contact",
        headers={"Authorization": f"Bearer {recent_response['access_token']}"},
    )

    assert response.status_code == 200
    assert response.json()["phone"] == "+66123456789"


def test_create_patient_with_contact_allows_stale_session(client: TestClient, db: Session):
    admin = create_test_user(db, UserRole.admin)
    stale_response = create_login_response(
        admin,
        db=db,
        mfa_verified=True,
        mfa_authenticated_at=datetime.now(timezone.utc) - timedelta(hours=5),
    )

    response = client.post(
        "/patients",
        json={
            "first_name": "Create",
            "last_name": "Blocked",
            "date_of_birth": "1992-06-15",
            "phone": "+66123456789",
        },
        headers={"Authorization": f"Bearer {stale_response['access_token']}"},
    )

    assert response.status_code == 201


def test_update_patient_contact_allows_stale_session(client: TestClient, db: Session):
    admin = create_test_user(db, UserRole.admin)
    headers = get_auth_headers(admin)
    patient_response = client.post(
        "/patients",
        json={"first_name": "Update", "last_name": "Guard", "date_of_birth": "1992-06-15"},
        headers=headers,
    )
    assert patient_response.status_code == 201
    patient_id = patient_response.json()["id"]

    stale_response = create_login_response(
        admin,
        db=db,
        mfa_verified=True,
        mfa_authenticated_at=datetime.now(timezone.utc) - timedelta(hours=5),
    )
    response = client.put(
        f"/patients/{patient_id}",
        json={"phone": "+66123456789"},
        headers={"Authorization": f"Bearer {stale_response['access_token']}"},
    )

    assert response.status_code == 200
    assert response.json()["id"] == patient_id


def test_patient_delete_is_soft_delete(client: TestClient, db: Session):
    admin = create_test_user(db, UserRole.admin)
    admin_headers = get_auth_headers(admin)

    create_response = client.post(
        "/patients",
        json={
            "first_name": "Soft",
            "last_name": "Deleted",
            "date_of_birth": "1990-01-01",
        },
        headers=admin_headers,
    )
    assert create_response.status_code == 201
    patient_id = create_response.json()["id"]

    delete_response = client.delete(f"/patients/{patient_id}", headers=admin_headers)
    assert delete_response.status_code == 204

    patient_row = db.scalar(select(Patient).where(Patient.id == UUID(patient_id)))
    assert patient_row is not None
    assert patient_row.is_active is False
    assert patient_row.deleted_at is not None
    assert patient_row.deleted_by == admin.id

    list_response = client.get("/patients", headers=admin_headers)
    assert list_response.status_code == 200
    listed_ids = {item["id"] for item in list_response.json()["items"]}
    assert patient_id not in listed_ids


def test_patient_delete_cascades_pressure_and_heart_sound_records(client: TestClient, db: Session):
    admin = create_test_user(db, UserRole.admin)
    admin_headers = get_auth_headers(admin)

    create_response = client.post(
        "/patients",
        json={
            "first_name": "Cascade",
            "last_name": "Delete",
            "date_of_birth": "1990-01-01",
        },
        headers=admin_headers,
    )
    assert create_response.status_code == 201
    patient_id = UUID(create_response.json()["id"])

    db.add(
        PressureRecord(
            patient_id=patient_id,
            device_id="device-pressure-001",
            heart_rate=72,
            sys_rate=120,
            dia_rate=80,
            measured_at=datetime.now(timezone.utc),
        )
    )
    db.add(
        HeartSoundRecord(
            patient_id=patient_id,
            device_id="device-heart-001",
            mac_address="00:11:22:33:44:55",
            position=1,
            blob_url="https://example.com/heart.wav",
            recorded_at=datetime.now(timezone.utc),
        )
    )
    db.commit()

    delete_response = client.delete(f"/patients/{patient_id}", headers=admin_headers)
    assert delete_response.status_code == 204

    remaining_pressure = db.scalars(
        select(PressureRecord).where(PressureRecord.patient_id == patient_id)
    ).all()
    remaining_heart_sounds = db.scalars(
        select(HeartSoundRecord).where(HeartSoundRecord.patient_id == patient_id)
    ).all()

    assert remaining_pressure == []
    assert remaining_heart_sounds == []


def test_patient_bulk_delete_is_atomic_when_any_patient_is_missing(client: TestClient, db: Session):
    admin = create_test_user(db, UserRole.admin)
    admin_headers = get_auth_headers(admin)

    created_ids: list[str] = []
    for first_name in ("Atomic", "Rollback"):
        create_response = client.post(
            "/patients",
            json={
                "first_name": first_name,
                "last_name": "Delete",
                "date_of_birth": "1990-01-01",
            },
            headers=admin_headers,
        )
        assert create_response.status_code == 201
        created_ids.append(create_response.json()["id"])

    response = client.post(
        "/patients/bulk-delete",
        json={"ids": [created_ids[0], str(uuid4()), created_ids[1]]},
        headers=admin_headers,
    )

    assert response.status_code == 200
    assert response.json()["deleted"] == 0
    assert len(response.json()["errors"]) == 1

    for patient_id in created_ids:
        patient_row = db.scalar(select(Patient).where(Patient.id == UUID(patient_id)))
        assert patient_row is not None
        assert patient_row.is_active is True
        assert patient_row.deleted_at is None


def test_patient_bulk_delete_rejects_batches_over_one_hundred_ids(client: TestClient, db: Session):
    admin = create_test_user(db, UserRole.admin)
    admin_headers = get_auth_headers(admin)

    response = client.post(
        "/patients/bulk-delete",
        json={"ids": [str(uuid4()) for _ in range(101)]},
        headers=admin_headers,
    )

    assert response.status_code == 422


def test_patient_api_unauthorized(client: TestClient):
    response = client.get("/patients")
    assert response.status_code == 401

    response = client.post("/patients", json={"first_name": "Test", "last_name": "User"})
    assert response.status_code == 401


def test_medical_student_patient_access_is_read_only_and_assignment_scoped(client: TestClient, db: Session):
    medical_student = create_test_user(db, UserRole.medical_student)
    admin = create_test_user(db, UserRole.admin)

    medical_student_headers = get_auth_headers(medical_student)
    admin_headers = get_auth_headers(admin)

    create_response = client.post(
        "/patients",
        json={"first_name": "Blocked", "last_name": "MedicalStudent", "date_of_birth": "1990-01-01"},
        headers=medical_student_headers,
    )
    assert create_response.status_code == 403

    patient_response = client.post(
        "/patients",
        json={"first_name": "Admin", "last_name": "Created", "date_of_birth": "1989-01-01"},
        headers=admin_headers,
    )
    assert patient_response.status_code == 201
    patient_id = patient_response.json()["id"]

    unassigned_list = client.get("/patients", headers=medical_student_headers)
    assert unassigned_list.status_code == 200
    assert unassigned_list.json()["total"] == 0

    unassigned_get = client.get(f"/patients/{patient_id}", headers=medical_student_headers)
    assert unassigned_get.status_code == 403

    assign_doctor_to_patient(db, medical_student.id, patient_id)

    assigned_list = client.get("/patients", headers=medical_student_headers)
    assert assigned_list.status_code == 200
    assigned_ids = {item["id"] for item in assigned_list.json()["items"]}
    assert patient_id in assigned_ids

    assigned_get = client.get(f"/patients/{patient_id}", headers=medical_student_headers)
    assert assigned_get.status_code == 200
    assert assigned_get.json()["id"] == patient_id

    assert client.put(f"/patients/{patient_id}", json={"first_name": "No"}, headers=medical_student_headers).status_code == 403


def test_doctor_list_excludes_unassigned_patients(client: TestClient, db: Session):
    doctor = create_test_user(db, UserRole.doctor)
    admin = create_test_user(db, UserRole.admin)

    headers_admin = get_auth_headers(admin)
    headers_doctor = get_auth_headers(doctor)

    first = client.post(
        "/patients",
        json={"first_name": "Assigned", "last_name": "Patient", "date_of_birth": "1990-01-01"},
        headers=headers_admin,
    )
    second = client.post(
        "/patients",
        json={"first_name": "Unassigned", "last_name": "Patient", "date_of_birth": "1991-01-01"},
        headers=headers_admin,
    )
    assert first.status_code == 201
    assert second.status_code == 201

    assigned_id = first.json()["id"]
    unassigned_id = second.json()["id"]
    assign_doctor_to_patient(db, doctor.id, assigned_id)

    list_response = client.get("/patients", headers=headers_doctor)
    assert list_response.status_code == 200
    items = list_response.json()["items"]
    ids = {item["id"] for item in items}
    assert assigned_id in ids
    assert unassigned_id not in ids


def test_doctor_get_unassigned_patient_is_blocked(client: TestClient, db: Session):
    doctor = create_test_user(db, UserRole.doctor)
    admin = create_test_user(db, UserRole.admin)
    headers_admin = get_auth_headers(admin)
    headers_doctor = get_auth_headers(doctor)

    created = client.post(
        "/patients",
        json={"first_name": "No", "last_name": "Assignment", "date_of_birth": "1989-10-01"},
        headers=headers_admin,
    )
    assert created.status_code == 201
    patient_id = created.json()["id"]

    response = client.get(f"/patients/{patient_id}", headers=headers_doctor)
    assert response.status_code == 403
    assert "not assigned" in response.json()["detail"].lower()

    denied_audit = db.scalar(
        select(AuditLog).where(
            AuditLog.user_id == doctor.id,
            AuditLog.action == "patient_access_denied",
            AuditLog.resource_id == UUID(patient_id),
        )
    )
    assert denied_audit is not None


def test_doctor_contact_reveal_for_unassigned_patient_is_blocked(client: TestClient, db: Session):
    doctor = create_test_user(db, UserRole.doctor)
    admin = create_test_user(db, UserRole.admin)
    headers_admin = get_auth_headers(admin)
    headers_doctor = get_auth_headers(doctor)

    created = client.post(
        "/patients",
        json={
            "first_name": "Hidden",
            "last_name": "Contact",
            "date_of_birth": "1989-10-01",
            "phone": "+66123456789",
        },
        headers=headers_admin,
    )
    assert created.status_code == 201
    patient_id = created.json()["id"]

    response = client.get(f"/patients/{patient_id}/contact", headers=headers_doctor)
    assert response.status_code == 403
    assert "not assigned" in response.json()["detail"].lower()


def test_admin_manage_assignments_and_primary_rules(client: TestClient, db: Session):
    admin = create_test_user(db, UserRole.admin)
    doctor_a = create_test_user(db, UserRole.doctor)
    doctor_b = create_test_user(db, UserRole.doctor)

    admin_headers = get_auth_headers(admin)

    patient_resp = client.post(
        "/patients",
        json={"first_name": "Assign", "last_name": "Target", "date_of_birth": "1992-07-07"},
        headers=admin_headers,
    )
    assert patient_resp.status_code == 201
    patient_id = patient_resp.json()["id"]

    list_empty = client.get(f"/patients/{patient_id}/assignments", headers=admin_headers)
    assert list_empty.status_code == 200
    assert list_empty.json()["total"] == 0

    add_primary = client.post(
        f"/patients/{patient_id}/assignments",
        json={"doctor_id": str(doctor_a.id)},
        headers=admin_headers,
    )
    assert add_primary.status_code == 201
    assert add_primary.json()["role"] == "primary"

    add_consulting = client.post(
        f"/patients/{patient_id}/assignments",
        json={"doctor_id": str(doctor_b.id)},
        headers=admin_headers,
    )
    assert add_consulting.status_code == 201
    assert add_consulting.json()["role"] == "consulting"
    consulting_assignment_id = add_consulting.json()["id"]

    make_primary = client.patch(
        f"/patients/{patient_id}/assignments/{consulting_assignment_id}",
        json={"role": "primary"},
        headers=admin_headers,
    )
    assert make_primary.status_code == 200
    assert make_primary.json()["role"] == "primary"

    after_switch = client.get(f"/patients/{patient_id}/assignments", headers=admin_headers)
    assert after_switch.status_code == 200
    items = after_switch.json()["items"]
    primaries = [item for item in items if item["role"] == "primary"]
    assert len(primaries) == 1
    assert primaries[0]["doctor_id"] == str(doctor_b.id)

    delete_primary = client.delete(
        f"/patients/{patient_id}/assignments/{consulting_assignment_id}",
        headers=admin_headers,
    )
    assert delete_primary.status_code == 204

    after_delete = client.get(f"/patients/{patient_id}/assignments", headers=admin_headers)
    assert after_delete.status_code == 200
    items_after_delete = after_delete.json()["items"]
    assert len(items_after_delete) == 1
    assert items_after_delete[0]["doctor_id"] == str(doctor_a.id)
    assert items_after_delete[0]["role"] == "primary"

    duplicate = client.post(
        f"/patients/{patient_id}/assignments",
        json={"doctor_id": str(doctor_a.id)},
        headers=admin_headers,
    )
    assert duplicate.status_code == 409


def test_non_admin_cannot_manage_assignments(client: TestClient, db: Session):
    admin = create_test_user(db, UserRole.admin)
    doctor = create_test_user(db, UserRole.doctor)
    medical_student = create_test_user(db, UserRole.medical_student)

    admin_headers = get_auth_headers(admin)
    doctor_headers = get_auth_headers(doctor)
    medical_student_headers = get_auth_headers(medical_student)

    patient_resp = client.post(
        "/patients",
        json={"first_name": "Policy", "last_name": "Scope", "date_of_birth": "1993-03-03"},
        headers=admin_headers,
    )
    assert patient_resp.status_code == 201
    patient_id = patient_resp.json()["id"]

    for headers in (doctor_headers, medical_student_headers):
        assert client.get(f"/patients/{patient_id}/assignments", headers=headers).status_code == 403
        assert client.post(
            f"/patients/{patient_id}/assignments",
            json={"doctor_id": str(doctor.id)},
            headers=headers,
        ).status_code == 403


def test_assignment_actions_are_audited(client: TestClient, db: Session):
    admin = create_test_user(db, UserRole.admin)
    doctor = create_test_user(db, UserRole.doctor)
    admin_headers = get_auth_headers(admin)

    patient_resp = client.post(
        "/patients",
        json={"first_name": "Audit", "last_name": "Assignment", "date_of_birth": "1994-04-04"},
        headers=admin_headers,
    )
    assert patient_resp.status_code == 201
    patient_id = patient_resp.json()["id"]

    create_resp = client.post(
        f"/patients/{patient_id}/assignments",
        json={"doctor_id": str(doctor.id)},
        headers=admin_headers,
    )
    assert create_resp.status_code == 201
    assignment_id = create_resp.json()["id"]

    update_resp = client.patch(
        f"/patients/{patient_id}/assignments/{assignment_id}",
        json={"role": "consulting"},
        headers=admin_headers,
    )
    assert update_resp.status_code == 200

    delete_resp = client.delete(
        f"/patients/{patient_id}/assignments/{assignment_id}",
        headers=admin_headers,
    )
    assert delete_resp.status_code == 204

    actions = db.scalars(
        select(AuditLog.action).where(
            AuditLog.user_id == admin.id,
            AuditLog.resource_type == "doctor_patient_assignment",
        )
    ).all()

    assert "patient_assignment_create" in actions
    assert "patient_assignment_update" in actions
    assert "patient_assignment_delete" in actions
