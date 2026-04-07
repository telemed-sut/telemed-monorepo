"""Login, invite, and password lifecycle helpers for authentication."""

import hashlib
import secrets
from datetime import timedelta
from typing import Optional

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.core.security import get_password_hash, verify_password
from app.models.enums import UserRole
from app.models.invite import UserInvite
from app.models.user import User

from .auth_tokens import _normalize_dt, _now_utc


def authenticate_user(db: Session, email: str, password: str) -> Optional[User]:
    stmt = select(User).where(User.email == email, User.deleted_at.is_(None))
    user = db.scalar(stmt)
    if user is None:
        return None
    if not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def reset_user_password(db: Session, user: User, new_password: str) -> None:
    user.password_hash = get_password_hash(new_password)
    user.password_changed_at = _now_utc()
    db.flush()


def hash_invite_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_user_invite(
    db: Session,
    *,
    email: str,
    role: UserRole,
    expires_in_hours: int,
    created_by: User,
) -> tuple[str, UserInvite]:
    raw_token = secrets.token_urlsafe(32)
    token_hash = hash_invite_token(raw_token)
    now = _now_utc()
    expires_at = now + timedelta(hours=expires_in_hours)

    existing_invites = db.scalars(
        select(UserInvite).where(
            and_(
                UserInvite.email == email.lower(),
                UserInvite.used_at.is_(None),
                UserInvite.expires_at > now,
            )
        )
    ).all()
    for existing_invite in existing_invites:
        existing_invite.used_at = now
        db.add(existing_invite)

    invite = UserInvite(
        token_hash=token_hash,
        email=email.lower(),
        role=role,
        expires_at=expires_at,
        created_by=created_by.id,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return raw_token, invite


def get_active_invite_by_token(db: Session, token: str) -> Optional[UserInvite]:
    token_hash = hash_invite_token(token)
    invite = db.scalar(select(UserInvite).where(UserInvite.token_hash == token_hash))
    if not invite:
        return None
    if invite.used_at is not None:
        return None
    if _normalize_dt(invite.expires_at) <= _now_utc():
        return None
    return invite


def consume_invite(db: Session, invite: UserInvite) -> None:
    invite.used_at = _now_utc()
    db.add(invite)
    db.commit()
