from fastapi import APIRouter, Depends, HTTPException, Request, status
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from app.models.user import User
from app.schemas.auth import LoginRequest, TokenResponse, UserMeResponse
from app.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])

# Create limiter for auth endpoints
limiter = Limiter(key_func=get_remote_address)


@router.get("/me", response_model=UserMeResponse)
def get_me(current_user: User = Depends(auth_service.get_current_user)):
    """Get current authenticated user's profile"""
    return UserMeResponse(
        id=str(current_user.id),
        email=current_user.email,
        first_name=current_user.first_name,
        last_name=current_user.last_name,
        role=current_user.role.value,
    )


@router.post("/login", response_model=TokenResponse)
@limiter.limit("60/minute")  # Increased limit for dev convenience
def login(request: Request, payload: LoginRequest, db: Session = Depends(auth_service.get_db)):
    user = auth_service.authenticate_user(db, payload.email, payload.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return auth_service.create_login_response(user)


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("60/minute")
def refresh_token(
    request: Request,
    current_user: User = Depends(auth_service.get_current_user),
):
    """Refresh access token for authenticated user"""
    return auth_service.create_login_response(current_user)


@router.post("/logout")
@limiter.limit("60/minute")
def logout(
    request: Request,
    current_user: User = Depends(auth_service.get_current_user),
):
    """Logout endpoint (stateless JWT - client should discard token)"""
    return {"message": "Successfully logged out"}
