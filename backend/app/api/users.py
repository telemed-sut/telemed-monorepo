from typing import Any, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, or_
from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models.user import User, UserRole
from app.schemas.user import UserCreate, UserOut, UserUpdate, UserListResponse
from app.services import auth as auth_service
from app.services.auth import get_admin_user, get_current_user

router = APIRouter(prefix="/users", tags=["users"])


def check_user_access(
    user_id: UUID,
    current_user: User = Depends(get_current_user),
) -> User:
    """
    Ensure the user has permission to modify the target user.
    Admins can modify anyone. Users can modify themselves.
    """
    if current_user.role != UserRole.admin and current_user.id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The user doesn't have enough privileges",
        )
    return current_user



@router.get("", response_model=UserListResponse)
def get_users(
    db: Session = Depends(auth_service.get_db),
    current_user: User = Depends(auth_service.get_admin_or_staff_user),
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    q: str = Query(None, min_length=1),
    sort: str = Query("created_at"),
    order: str = Query("desc", regex="^(asc|desc)$"),
    role: UserRole = Query(None),
) -> Any:
    """
    Retrieve users.
    Only admins can list all users.
    """
    query = select(User)

    if q:
        search = f"%{q}%"
        query = query.where(
            or_(
                User.email.ilike(search),
                User.first_name.ilike(search),
                User.last_name.ilike(search),
            )
        )
    
    if role:
        query = query.where(User.role == role)

    # Count total matching records for pagination
    # Use subquery for count to respect filters
    count_query = select(func.count()).select_from(query.subquery())
    total = db.scalar(count_query)

    # Sorting
    if hasattr(User, sort):
        sort_column = getattr(User, sort)
    else:
        sort_column = User.created_at

    if order == "desc":
        query = query.order_by(sort_column.desc())
    else:
        query = query.order_by(sort_column.asc())

    # Pagination
    query = query.offset((page - 1) * limit).limit(limit)
    users = db.scalars(query).all()

    return UserListResponse(
        items=list(users),
        page=page,
        limit=limit,
        total=total if total else 0,
    )


@router.post("", response_model=UserOut)
def create_user(
    *,
    db: Session = Depends(auth_service.get_db),
    user_in: UserCreate,
    current_user: User = Depends(get_admin_user),
) -> Any:
    """
    Create new user.
    Only admins can create users.
    """
    user = db.scalar(select(User).where(User.email == user_in.email))
    if user:
        raise HTTPException(
            status_code=400,
            detail="The user with this username already exists in the system.",
        )
    
    user = User(
        email=user_in.email,
        password_hash=get_password_hash(user_in.password),
        first_name=user_in.first_name,
        last_name=user_in.last_name,
        role=user_in.role,
        # is_active and is_superuser are not in the User model yet
        # is_active=user_in.is_active,
        # is_superuser=user_in.is_superuser,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.put("/{user_id}", response_model=UserOut)
def update_user(
    *,
    db: Session = Depends(auth_service.get_db),
    user_id: UUID,
    user_in: UserUpdate,
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Update a user.
    """
    # Check permissions manually since we need both user_id and current_user
    check_user_access(user_id, current_user)

    user = db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(
            status_code=404,
            detail="The user with this id does not exist in the system",
        )

    if user_in.email:
         existing_user = db.scalar(select(User).where(User.email == user_in.email))
         if existing_user and existing_user.id != user_id:
             raise HTTPException(
                status_code=400,
                detail="A user with this email already exists.",
            )

    update_data = user_in.model_dump(exclude_unset=True)
    
    # If password is provided, hash it
    if "password" in update_data and update_data["password"]:
        hashed_password = get_password_hash(update_data["password"])
        del update_data["password"]
        user.password_hash = hashed_password
    
    # Remove fields that are not in the model
    if "is_active" in update_data:
        del update_data["is_active"]
    if "is_superuser" in update_data:
        del update_data["is_superuser"]

    for field, value in update_data.items():
        if hasattr(user, field):
            setattr(user, field, value)

    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("/{user_id}", response_model=UserOut)
def read_user_by_id(
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(auth_service.get_db),
) -> Any:
    """
    Get a specific user by id.
    """
    user = db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(
            status_code=404,
            detail="The user with this id does not exist in the system",
        )
    
    check_user_access(user_id, current_user)
        
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    *,
    db: Session = Depends(auth_service.get_db),
    user_id: UUID,
    current_user: User = Depends(get_admin_user),
) -> None:
    """
    Delete a user.
    Only admins can delete users.
    """
    user = db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(
            status_code=404,
            detail="The user with this id does not exist in the system",
        )
    
    # Prevent deleting self
    if user.id == current_user.id:
        raise HTTPException(
            status_code=400,
            detail="Users cannot delete themselves",
        )
    
    db.delete(user)
    db.commit()
    return None
