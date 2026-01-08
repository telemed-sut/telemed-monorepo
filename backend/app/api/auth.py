from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.models.user import User
from app.schemas.auth import LoginRequest, TokenResponse
from app.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(auth_service.get_db)):
    user = auth_service.authenticate_user(db, payload.email, payload.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return auth_service.create_login_response(user)


@router.post("/refresh", response_model=TokenResponse)
def refresh_token(
    current_user: User = Depends(auth_service.get_current_user),
):
    """Refresh access token for authenticated user"""
    return auth_service.create_login_response(current_user)


@router.post("/logout")
def logout(
    current_user: User = Depends(auth_service.get_current_user),
):
    """Logout endpoint (stateless JWT - client should discard token)"""
    return {"message": "Successfully logged out"}
