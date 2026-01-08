import pytest
from datetime import date
from uuid import uuid4
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

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
    user = create_test_user(db)
    headers = get_auth_headers(user)
    
    # Test create patient
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
    
    # Test get patient
    response = client.get(f"/patients/{patient_id}", headers=headers)
    assert response.status_code == 200
    assert response.json()["first_name"] == "API"
    
    # Test list patients
    response = client.get("/patients", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert "total" in data
    
    # Test update patient
    update_data = {"first_name": "Updated"}
    response = client.put(f"/patients/{patient_id}", json=update_data, headers=headers)
    assert response.status_code == 200
    assert response.json()["first_name"] == "Updated"
    
    # Test delete patient
    response = client.delete(f"/patients/{patient_id}", headers=headers)
    assert response.status_code == 204


def test_patient_api_unauthorized(client: TestClient):
    """Test that patient endpoints require authentication"""
    # Test without auth headers
    response = client.get("/patients")
    assert response.status_code == 401
    
    response = client.post("/patients", json={"first_name": "Test", "last_name": "User"})
    assert response.status_code == 401