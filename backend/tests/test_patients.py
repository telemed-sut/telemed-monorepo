import pytest
from datetime import date
from uuid import UUID, uuid4
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.doctor_patient_assignment import DoctorPatientAssignment
from app.models.patient import Patient
from app.models.user import User, UserRole
from app.core.security import get_password_hash
from app.services.auth import create_login_response
from app.services.patient import create_patient, get_patient, list_patients
from app.schemas.patient import PatientCreate


def create_test_user(db: Session, role: UserRole = UserRole.staff) -> User:
    """Helper to create test user"""
    user = User(
        email=f"test_{uuid4()}@example.com",
        password_hash=get_password_hash("password"),
        role=role
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_auth_headers(user: User) -> dict:
    """Helper to get auth headers for user"""
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
    """Test patient creation"""
    patient_data = PatientCreate(
        first_name="John",
        last_name="Doe",
        date_of_birth=date(1990, 1, 1),
        gender="Male",
        phone="+1234567890",
        email="john.doe@example.com"
    )
    
    patient = create_patient(db, patient_data)
    
    assert patient.first_name == "John"
    assert patient.last_name == "Doe"
    assert patient.email == "john.doe@example.com"
    assert patient.id is not None


def test_get_patient(db: Session):
    """Test getting patient by ID"""
    # Create patient first
    patient_data = PatientCreate(
        first_name="Jane",
        last_name="Smith",
        date_of_birth=date(1985, 5, 15)
    )
    created_patient = create_patient(db, patient_data)
    
    # Get patient
    retrieved_patient = get_patient(db, str(created_patient.id))
    
    assert retrieved_patient is not None
    assert retrieved_patient.id == created_patient.id
    assert retrieved_patient.first_name == "Jane"


def test_list_patients(db: Session):
    """Test listing patients with pagination"""
    # Create test patients
    for i in range(5):
        patient_data = PatientCreate(
            first_name=f"Patient{i}",
            last_name=f"Test{i}",
            date_of_birth=date(1980 + i, 1, 1)
        )
        create_patient(db, patient_data)
    
    # Test pagination
    patients, total = list_patients(db, page=1, limit=3, q=None, sort="created_at", order="desc")
    
    assert len(patients) == 3
    assert total == 5


def test_patient_api_endpoints(client: TestClient, db: Session):
    """Test patient API endpoints with authentication"""
    staff = create_test_user(db)
    admin = create_test_user(db, UserRole.admin)
    headers = get_auth_headers(staff)
    admin_headers = get_auth_headers(admin)

    # Test create patient (staff can create)
    patient_data = {
        "first_name": "API",
        "last_name": "Test",
        "date_of_birth": "1992-06-15",
        "email": "api.test@example.com"
    }

    response = client.post("/patients", json=patient_data, headers=headers)
    assert response.status_code == 201
    created_patient = response.json()
    patient_id = created_patient["id"]

    # Test get patient (staff can read)
    response = client.get(f"/patients/{patient_id}", headers=headers)
    assert response.status_code == 200
    assert response.json()["first_name"] == "API"

    # Test list patients (staff can list)
    response = client.get("/patients", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert "total" in data

    # Test update patient (staff can update)
    update_data = {"first_name": "Updated"}
    response = client.put(f"/patients/{patient_id}", json=update_data, headers=headers)
    assert response.status_code == 200
    assert response.json()["first_name"] == "Updated"

    # Test delete patient (only admin can delete)
    response = client.delete(f"/patients/{patient_id}", headers=admin_headers)
    assert response.status_code == 204


def test_patient_api_unauthorized(client: TestClient):
    """Test that patient endpoints require authentication"""
    # Test without auth headers
    response = client.get("/patients")
    assert response.status_code == 401
    
    response = client.post("/patients", json={"first_name": "Test", "last_name": "User"})
    assert response.status_code == 401


def test_doctor_list_only_assigned_patients(client: TestClient, db: Session):
    doctor = create_test_user(db, UserRole.doctor)
    staff = create_test_user(db, UserRole.staff)

    headers_staff = get_auth_headers(staff)
    headers_doctor = get_auth_headers(doctor)

    first = client.post(
        "/patients",
        json={"first_name": "Assigned", "last_name": "Patient", "date_of_birth": "1990-01-01"},
        headers=headers_staff,
    )
    second = client.post(
        "/patients",
        json={"first_name": "Unassigned", "last_name": "Patient", "date_of_birth": "1991-01-01"},
        headers=headers_staff,
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
    staff = create_test_user(db, UserRole.staff)
    headers_staff = get_auth_headers(staff)
    headers_doctor = get_auth_headers(doctor)

    created = client.post(
        "/patients",
        json={"first_name": "No", "last_name": "Assignment", "date_of_birth": "1989-10-01"},
        headers=headers_staff,
    )
    assert created.status_code == 201
    patient_id = created.json()["id"]

    response = client.get(f"/patients/{patient_id}", headers=headers_doctor)
    assert response.status_code == 403
    assert "not assigned" in response.json()["detail"].lower()
