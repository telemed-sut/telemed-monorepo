from datetime import datetime, timezone

import pytest
from sqlalchemy.orm import Session

from app.core.security import get_password_hash, verify_password
from app.models.user import User, UserRole
from app.services.auth import authenticate_user, create_login_response
from app.services.auth_tokens import _get_password_changed_marker, is_password_reset_token_stale


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
        role=UserRole.medical_student
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
        role=UserRole.medical_student
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
    assert response["user"]["email"] == "test@example.com"
    assert response["user"]["role"] == "admin"


def test_password_reset_token_marker_changes_for_same_second_updates():
    user = User(
        email="marker@example.com",
        password_hash="hashed_password",
        role=UserRole.medical_student,
    )

    initial_change = datetime(2026, 4, 8, 12, 0, 0, 100_000, tzinfo=timezone.utc)
    later_change = datetime(2026, 4, 8, 12, 0, 0, 900_000, tzinfo=timezone.utc)

    user.password_changed_at = initial_change
    initial_marker = _get_password_changed_marker(user)

    user.password_changed_at = later_change
    later_marker = _get_password_changed_marker(user)

    assert initial_marker != later_marker
    assert is_password_reset_token_stale(
        user,
        issued_at=None,
        password_changed_marker=initial_marker,
    ) is True
