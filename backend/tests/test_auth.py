import pytest
from sqlalchemy.orm import Session

from app.core.security import get_password_hash, verify_password
from app.models.user import User, UserRole
from app.services.auth import authenticate_user, create_login_response


def test_password_hashing():
    """Test password hashing and verification"""
    password = "TestPassword123"
    hashed = get_password_hash(password)
    
    assert hashed != password
    assert verify_password(password, hashed) is True
    assert verify_password("wrong_password", hashed) is False


def test_authenticate_user_success(db: Session):
    """Test successful user authentication"""
    # Create test user
    user = User(
        email="test@example.com",
        password_hash=get_password_hash("TestPassword123"),
        role=UserRole.staff
    )
    db.add(user)
    db.commit()
    
    # Test authentication
    authenticated_user = authenticate_user(db, "test@example.com", "TestPassword123")
    assert authenticated_user is not None
    assert authenticated_user.email == "test@example.com"


def test_authenticate_user_invalid_email(db: Session):
    """Test authentication with invalid email"""
    result = authenticate_user(db, "nonexistent@example.com", "password")
    assert result is None


def test_authenticate_user_invalid_password(db: Session):
    """Test authentication with invalid password"""
    # Create test user
    user = User(
        email="test@example.com",
        password_hash=get_password_hash("correct_password"),
        role=UserRole.staff
    )
    db.add(user)
    db.commit()
    
    # Test with wrong password
    result = authenticate_user(db, "test@example.com", "wrong_password")
    assert result is None


def test_create_login_response():
    """Test JWT token creation"""
    user = User(
        email="test@example.com",
        password_hash="hashed_password",
        role=UserRole.admin
    )
    
    response = create_login_response(user)
    
    assert "access_token" in response
    assert response["token_type"] == "bearer"
    assert "expires_in" in response
    assert isinstance(response["expires_in"], int)