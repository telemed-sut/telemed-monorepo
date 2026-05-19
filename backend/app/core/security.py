import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

import jwt
from jwt.exceptions import PyJWTError as JWTError
import bcrypt

from app.core.config import get_settings

ALGORITHM = "HS256"


def get_password_hash(password: str) -> str:
    """Hash a password using bcrypt."""
    # Salt is included in the resulting hash string.
    # bcrypt.hashpw returns bytes; we decode to utf-8 string for storage.
    return bcrypt.hashpw(
        password.encode("utf-8"),
        bcrypt.gensalt()
    ).decode("utf-8")


def get_pin_hash(pin: str) -> str:
    """Store the patient PIN as-is (plaintext).

    Simplified flow: the patient app uses a 4-digit numeric PIN that's stored
    directly in patients.pin_hash without bcrypt or pepper. The column name
    stays 'pin_hash' to avoid a schema rename.
    """
    return (pin or "").strip()


def verify_pin(plain_pin: str, hashed_pin: str) -> bool:
    """Plaintext string equality check (see get_pin_hash)."""
    if plain_pin is None or hashed_pin is None:
        return False
    return plain_pin.strip() == hashed_pin.strip()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its bcrypt hash."""
    if not plain_password or not hashed_password:
        return False
    try:
        return bcrypt.checkpw(
            plain_password.encode("utf-8"),
            hashed_password.encode("utf-8")
        )
    except Exception:
        return False


def create_access_token(data: Dict[str, Any], expires_in: int | None = None) -> str:
    settings = get_settings()
    to_encode = data.copy()
    ttl = expires_in if expires_in is not None else settings.jwt_expires_in
    now = datetime.now(timezone.utc)
    expire = now + timedelta(seconds=ttl)
    to_encode.update({"iat": now, "exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.jwt_secret, algorithm=ALGORITHM)
    return encoded_jwt


def decode_token(token: str) -> Dict[str, Any]:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
        return payload
    except JWTError as exc:  # pragma: no cover - passthrough to caller
        raise exc


def hash_security_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_security_token(bytes_length: int = 32) -> str:
    return secrets.token_urlsafe(bytes_length)
