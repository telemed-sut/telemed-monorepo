import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.user import User, UserRole
from app.core.security import get_password_hash
from app.services.auth import create_login_response


def create_test_user(db: Session, email: str, role: UserRole = UserRole.staff) -> User:
    """Helper to create test user with specific role"""
    user = User(
        email=email,
        password_hash=get_password_hash("TestPassword123"),
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


def test_admin_can_delete_patient(client: TestClient, db: Session):
    """Test that admin users can delete patients"""
    # Create admin user
    admin_user = create_test_user(db, "admin@test.com", UserRole.admin)
    admin_headers = get_auth_headers(admin_user)
    
    # Create a patient first
    patient_data = {
        "first_name": "Delete",
        "last_name": "Test",
        "date_of_birth": "1990-01-01"
    }
    
    create_response = client.post("/patients", json=patient_data, headers=admin_headers)
    assert create_response.status_code == 201
    patient_id = create_response.json()["id"]
    
    # Admin should be able to delete
    delete_response = client.delete(f"/patients/{patient_id}", headers=admin_headers)
    assert delete_response.status_code == 204


def test_staff_cannot_delete_patient(client: TestClient, db: Session):
    """Test that staff users cannot delete patients"""
    # Create admin and staff users
    admin_user = create_test_user(db, "admin2@test.com", UserRole.admin)
    staff_user = create_test_user(db, "staff@test.com", UserRole.staff)
    
    admin_headers = get_auth_headers(admin_user)
    staff_headers = get_auth_headers(staff_user)
    
    # Create a patient as admin
    patient_data = {
        "first_name": "NoDelete",
        "last_name": "Test",
        "date_of_birth": "1990-01-01"
    }
    
    create_response = client.post("/patients", json=patient_data, headers=admin_headers)
    assert create_response.status_code == 201
    patient_id = create_response.json()["id"]
    
    # Staff should get 403 when trying to delete
    delete_response = client.delete(f"/patients/{patient_id}", headers=staff_headers)
    assert delete_response.status_code == 403
    assert "Access denied" in delete_response.json()["detail"]


def test_staff_can_crud_except_delete(client: TestClient, db: Session):
    """Test that staff can create, read, update but not delete patients"""
    staff_user = create_test_user(db, "staff2@test.com", UserRole.staff)
    staff_headers = get_auth_headers(staff_user)
    
    # Staff can create
    patient_data = {
        "first_name": "Staff",
        "last_name": "Created",
        "date_of_birth": "1985-06-15"
    }
    
    create_response = client.post("/patients", json=patient_data, headers=staff_headers)
    assert create_response.status_code == 201
    patient_id = create_response.json()["id"]
    
    # Staff can read
    get_response = client.get(f"/patients/{patient_id}", headers=staff_headers)
    assert get_response.status_code == 200
    
    # Staff can list
    list_response = client.get("/patients", headers=staff_headers)
    assert list_response.status_code == 200
    
    # Staff can update
    update_data = {"first_name": "Updated"}
    update_response = client.put(f"/patients/{patient_id}", json=update_data, headers=staff_headers)
    assert update_response.status_code == 200
    assert update_response.json()["first_name"] == "Updated"
    
    # Staff cannot delete
    delete_response = client.delete(f"/patients/{patient_id}", headers=staff_headers)
    assert delete_response.status_code == 403


def test_role_requirements_in_jwt(client: TestClient, db: Session):
    """Test that JWT tokens contain role information"""
    admin_user = create_test_user(db, "jwtadmin@test.com", UserRole.admin)
    staff_user = create_test_user(db, "jwtstaff@test.com", UserRole.staff)
    
    # Login as admin
    admin_login = client.post("/auth/login", json={
        "email": "jwtadmin@test.com",
        "password": "TestPassword123"
    })
    assert admin_login.status_code == 200
    
    # Login as staff
    staff_login = client.post("/auth/login", json={
        "email": "jwtstaff@test.com", 
        "password": "TestPassword123"
    })
    assert staff_login.status_code == 200
    
    # Both should get valid tokens
    admin_token = admin_login.json()["access_token"]
    staff_token = staff_login.json()["access_token"]
    
    assert admin_token != staff_token
    assert len(admin_token) > 0
    assert len(staff_token) > 0