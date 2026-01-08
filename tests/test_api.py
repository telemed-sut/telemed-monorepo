import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.user import User, UserRole
from app.core.security import get_password_hash


def test_login_endpoint(client: TestClient, db: Session):
    """Test login endpoint"""
    # Create test user
    user = User(
        email="test@example.com",
        password_hash=get_password_hash("TestPassword123"),
        role=UserRole.staff
    )
    db.add(user)
    db.commit()
    
    # Test successful login
    response = client.post("/auth/login", json={
        "email": "test@example.com",
        "password": "TestPassword123"
    })
    
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert "expires_in" in data


def test_login_invalid_credentials(client: TestClient, db: Session):
    """Test login with invalid credentials"""
    response = client.post("/auth/login", json={
        "email": "nonexistent@example.com",
        "password": "wrongpassword"
    })
    
    assert response.status_code == 401
    assert "Invalid email or password" in response.json()["detail"]


def test_refresh_endpoint(client: TestClient, db: Session):
    """Test refresh token endpoint"""
    # Create user and login
    user = User(
        email="refresh@example.com",
        password_hash=get_password_hash("TestPassword123"),
        role=UserRole.admin
    )
    db.add(user)
    db.commit()
    
    # Login first
    login_response = client.post("/auth/login", json={
        "email": "refresh@example.com",
        "password": "TestPassword123"
    })
    token = login_response.json()["access_token"]
    
    # Test refresh
    headers = {"Authorization": f"Bearer {token}"}
    response = client.post("/auth/refresh", headers=headers)
    
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


def test_logout_endpoint(client: TestClient, db: Session):
    """Test logout endpoint"""
    # Create user and login
    user = User(
        email="logout@example.com",
        password_hash=get_password_hash("TestPassword123"),
        role=UserRole.staff
    )
    db.add(user)
    db.commit()
    
    # Login first
    login_response = client.post("/auth/login", json={
        "email": "logout@example.com",
        "password": "TestPassword123"
    })
    token = login_response.json()["access_token"]
    
    # Test logout
    headers = {"Authorization": f"Bearer {token}"}
    response = client.post("/auth/logout", headers=headers)
    
    assert response.status_code == 200
    assert response.json()["message"] == "Successfully logged out"


def test_protected_endpoint_without_token(client: TestClient):
    """Test that protected endpoints require authentication"""
    response = client.post("/auth/refresh")
    assert response.status_code == 401
    
    response = client.post("/auth/logout")
    assert response.status_code == 401