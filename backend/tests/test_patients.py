from datetime import date
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models.audit_log import AuditLog
from app.models.doctor_patient_assignment import DoctorPatientAssignment
from app.models.patient import Patient
from app.models.user import User, UserRole
from app.schemas.patient import PatientCreate
from app.services.auth import create_login_response
from app.services.patient import create_patient, get_patient, list_patients


def create_test_user(db: Session, role: UserRole = UserRole.staff) -> User:
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


def test_patient_api_unauthorized(client: TestClient):
    response = client.get("/patients")
    assert response.status_code == 401

    response = client.post("/patients", json={"first_name": "Test", "last_name": "User"})
    assert response.status_code == 401


def test_staff_is_forbidden_on_patient_endpoints(client: TestClient, db: Session):
    staff = create_test_user(db, UserRole.staff)
    admin = create_test_user(db, UserRole.admin)

    staff_headers = get_auth_headers(staff)
    admin_headers = get_auth_headers(admin)

    create_response = client.post(
        "/patients",
        json={"first_name": "Blocked", "last_name": "Staff", "date_of_birth": "1990-01-01"},
        headers=staff_headers,
    )
    assert create_response.status_code == 403

    patient_response = client.post(
        "/patients",
        json={"first_name": "Admin", "last_name": "Created", "date_of_birth": "1989-01-01"},
        headers=admin_headers,
    )
    assert patient_response.status_code == 201
    patient_id = patient_response.json()["id"]

    assert client.get("/patients", headers=staff_headers).status_code == 403
    assert client.get(f"/patients/{patient_id}", headers=staff_headers).status_code == 403
    assert client.put(f"/patients/{patient_id}", json={"first_name": "No"}, headers=staff_headers).status_code == 403


def test_doctor_list_only_assigned_patients(client: TestClient, db: Session):
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
    staff = create_test_user(db, UserRole.staff)

    admin_headers = get_auth_headers(admin)
    doctor_headers = get_auth_headers(doctor)
    staff_headers = get_auth_headers(staff)

    patient_resp = client.post(
        "/patients",
        json={"first_name": "Policy", "last_name": "Scope", "date_of_birth": "1993-03-03"},
        headers=admin_headers,
    )
    assert patient_resp.status_code == 201
    patient_id = patient_resp.json()["id"]

    for headers in (doctor_headers, staff_headers):
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
