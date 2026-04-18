import base64
import secrets
import hashlib
import hmac
import os
import struct
from datetime import datetime, timedelta, timezone
from typing import Any, Dict
from urllib.parse import quote

import jwt
from jwt.exceptions import PyJWTError as JWTError
import bcrypt

from app.core.config import get_settings

ALGORITHM = "HS256"
TOTP_PERIOD_SECONDS = 30
TOTP_DIGITS = 6
BACKUP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def get_password_hash(password: str) -> str:
    """Hash a password using bcrypt."""
    # Salt is included in the resulting hash string.
    # bcrypt.hashpw returns bytes; we decode to utf-8 string for storage.
    return bcrypt.hashpw(
        password.encode("utf-8"),
        bcrypt.gensalt()
    ).decode("utf-8")


def get_pin_hash(pin: str) -> str:
    """Hash a patient PIN using the application-level pepper if configured."""
    from app.core.config import get_settings
    pepper = get_settings().patient_pin_pepper
    if pepper:
        # Use HMAC-SHA256 to mix the pepper with the PIN before hashing with bcrypt.
        pin_peppered = hmac.new(
            pepper.encode("utf-8"),
            pin.encode("utf-8"),
            hashlib.sha256
        ).hexdigest()
        return get_password_hash(pin_peppered)
    return get_password_hash(pin)


def verify_pin(plain_pin: str, hashed_pin: str) -> bool:
    """Verify a patient PIN against its hash, incorporating the pepper if configured."""
    from app.core.config import get_settings
    pepper = get_settings().patient_pin_pepper
    if pepper:
        pin_peppered = hmac.new(
            pepper.encode("utf-8"),
            plain_pin.encode("utf-8"),
            hashlib.sha256
        ).hexdigest()
        return verify_password(pin_peppered, hashed_pin)
    return verify_password(plain_pin, hashed_pin)


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


def generate_totp_secret(length: int = 32) -> str:
    raw = os.urandom(length)
    # Remove trailing "=" so the secret is authenticator-friendly.
    return base64.b32encode(raw).decode("ascii").rstrip("=")


def normalize_totp_code(code: str | None) -> str | None:
    if code is None:
        return None
    normalized = "".join(ch for ch in code if ch.isdigit())
    return normalized or None


def build_totp_uri(secret: str, account_name: str, issuer: str) -> str:
    return (
        f"otpauth://totp/{quote(issuer)}:{quote(account_name)}"
        f"?secret={quote(secret)}&issuer={quote(issuer)}&algorithm=SHA1"
        f"&digits={TOTP_DIGITS}&period={TOTP_PERIOD_SECONDS}"
    )


def _decode_totp_secret(secret: str) -> bytes:
    normalized = "".join(secret.upper().split())
    padding = "=" * ((8 - (len(normalized) % 8)) % 8)
    return base64.b32decode(normalized + padding, casefold=True)


def _hotp(secret: bytes, counter: int, digits: int = TOTP_DIGITS) -> str:
    counter_bytes = struct.pack(">Q", counter)
    digest = hmac.new(secret, counter_bytes, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    binary_code = (
        ((digest[offset] & 0x7F) << 24)
        | ((digest[offset + 1] & 0xFF) << 16)
        | ((digest[offset + 2] & 0xFF) << 8)
        | (digest[offset + 3] & 0xFF)
    )
    return str(binary_code % (10 ** digits)).zfill(digits)


def generate_totp_code(secret: str, at_time: datetime | None = None) -> str:
    timestamp = int((at_time or datetime.now(timezone.utc)).timestamp())
    counter = timestamp // TOTP_PERIOD_SECONDS
    secret_bytes = _decode_totp_secret(secret)
    return _hotp(secret_bytes, counter, TOTP_DIGITS)


def verify_totp_code(
    secret: str,
    code: str,
    *,
    at_time: datetime | None = None,
    window: int = 2,
) -> bool:
    normalized_code = normalize_totp_code(code)
    if not normalized_code or len(normalized_code) != TOTP_DIGITS:
        return False

    timestamp = int((at_time or datetime.now(timezone.utc)).timestamp())
    counter = timestamp // TOTP_PERIOD_SECONDS
    secret_bytes = _decode_totp_secret(secret)

    for drift in range(-window, window + 1):
        candidate = _hotp(secret_bytes, counter + drift, TOTP_DIGITS)
        if hmac.compare_digest(candidate, normalized_code):
            return True
    return False


def hash_security_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_security_token(bytes_length: int = 32) -> str:
    return secrets.token_urlsafe(bytes_length)


def generate_backup_code(length: int = 10) -> str:
    return "".join(secrets.choice(BACKUP_CODE_ALPHABET) for _ in range(length))


def normalize_backup_code(code: str | None) -> str | None:
    if code is None:
        return None
    cleaned = "".join(ch for ch in code.upper() if ch.isalnum())
    return cleaned or None
