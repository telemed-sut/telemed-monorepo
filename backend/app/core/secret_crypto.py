import base64
import binascii
from typing import Final

try:
    from Cryptodome.Cipher import AES  # type: ignore
    from Cryptodome.Random import get_random_bytes  # type: ignore
except ImportError:  # pragma: no cover - dependency validation happens at runtime
    AES = None
    get_random_bytes = None


LEGACY_SECRET_VALUE_PREFIX: Final[str] = "encv1:"
SECRET_VALUE_PREFIX: Final[str] = "encv1:gcm:"
_AES_GCM_NONCE_BYTES: Final[int] = 12
_AES_GCM_TAG_BYTES: Final[int] = 16
_AES_GCM_KEY_BYTES: Final[int] = 32


class SecretCryptoError(RuntimeError):
    """Base error for secrets-at-rest encryption helpers."""


class SecretEncryptionConfigurationError(SecretCryptoError):
    """Raised when the encryption configuration is missing or invalid."""


class SecretDecryptionError(SecretCryptoError):
    """Raised when an encrypted secret cannot be decrypted safely."""


def _base64_decode(value: str, *, config_name: str) -> bytes:
    normalized = (value or "").strip()
    padding = "=" * ((4 - len(normalized) % 4) % 4)
    try:
        return base64.urlsafe_b64decode(normalized + padding)
    except (ValueError, binascii.Error) as exc:
        raise SecretEncryptionConfigurationError(
            f"{config_name} must be valid urlsafe base64."
        ) from exc


def validate_secret_encryption_key(
    value: str | None,
    *,
    config_name: str,
) -> str | None:
    if value is None:
        return None

    normalized = value.strip()
    if not normalized:
        return None

    decoded = _base64_decode(normalized, config_name=config_name)
    if len(decoded) != _AES_GCM_KEY_BYTES:
        raise SecretEncryptionConfigurationError(
            f"{config_name} must decode to exactly {_AES_GCM_KEY_BYTES} bytes."
        )
    return normalized


def has_secret_crypto_backend() -> bool:
    return AES is not None and get_random_bytes is not None


def is_current_encrypted_secret_value(value: str | None) -> bool:
    return bool(value and value.startswith(SECRET_VALUE_PREFIX))


def has_legacy_encrypted_secret_prefix(value: str | None) -> bool:
    return bool(
        value
        and value.startswith(LEGACY_SECRET_VALUE_PREFIX)
        and not value.startswith(SECRET_VALUE_PREFIX)
    )


def is_encrypted_secret_value(value: str | None) -> bool:
    return is_current_encrypted_secret_value(value) or has_legacy_encrypted_secret_prefix(value)


def has_reserved_secret_prefix(value: str | None) -> bool:
    return bool(value and value.startswith(LEGACY_SECRET_VALUE_PREFIX))


def _require_aes_support() -> None:
    if not has_secret_crypto_backend():
        raise SecretEncryptionConfigurationError(
            "Missing dependency 'pycryptodomex'. Install it to enable secrets-at-rest encryption."
        )


def _get_secret_key(
    *,
    config_name: str,
) -> bytes | None:
    from app.core.config import get_settings

    settings = get_settings()
    raw_value = getattr(settings, config_name)
    normalized = validate_secret_encryption_key(raw_value, config_name=config_name)
    if normalized is None:
        if settings.allow_insecure_secret_storage:
            return None
        raise SecretEncryptionConfigurationError(
            f"{config_name} is required unless ALLOW_INSECURE_SECRET_STORAGE=true."
        )
    return _base64_decode(normalized, config_name=config_name)


def encrypt_secret_value(
    value: str | None,
    *,
    config_name: str,
    purpose: str,
) -> str | None:
    if value is None:
        return None

    plaintext = value.strip()
    if not plaintext:
        return plaintext

    key = _get_secret_key(config_name=config_name)
    if key is None:
        return plaintext

    _require_aes_support()
    nonce = get_random_bytes(_AES_GCM_NONCE_BYTES)
    cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
    cipher.update(purpose.encode("utf-8"))
    ciphertext, tag = cipher.encrypt_and_digest(plaintext.encode("utf-8"))
    encoded = base64.urlsafe_b64encode(nonce + tag + ciphertext).decode("ascii").rstrip("=")
    return f"{SECRET_VALUE_PREFIX}{encoded}"


def decrypt_secret_value(
    value: str | None,
    *,
    config_name: str,
    purpose: str,
) -> str | None:
    if value is None:
        return None

    if is_current_encrypted_secret_value(value):
        payload = value[len(SECRET_VALUE_PREFIX) :]
    elif has_legacy_encrypted_secret_prefix(value):
        payload = value[len(LEGACY_SECRET_VALUE_PREFIX) :]
    else:
        return value

    key = _get_secret_key(config_name=config_name)
    if key is None:
        raise SecretDecryptionError(
            f"{config_name} is unavailable while encrypted secrets are stored."
        )

    _require_aes_support()
    try:
        raw = _base64_decode(payload, config_name=config_name)
    except SecretEncryptionConfigurationError as exc:
        raise SecretDecryptionError("Encrypted secret payload is invalid.") from exc

    minimum_size = _AES_GCM_NONCE_BYTES + _AES_GCM_TAG_BYTES + 1
    if len(raw) < minimum_size:
        raise SecretDecryptionError("Encrypted secret payload is truncated.")

    nonce = raw[:_AES_GCM_NONCE_BYTES]
    tag = raw[_AES_GCM_NONCE_BYTES : _AES_GCM_NONCE_BYTES + _AES_GCM_TAG_BYTES]
    ciphertext = raw[_AES_GCM_NONCE_BYTES + _AES_GCM_TAG_BYTES :]

    try:
        cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
        cipher.update(purpose.encode("utf-8"))
        plaintext = cipher.decrypt_and_verify(ciphertext, tag)
    except Exception as exc:  # pragma: no cover - concrete crypto failures vary by backend
        raise SecretDecryptionError("Encrypted secret failed authentication.") from exc

    try:
        return plaintext.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise SecretDecryptionError("Encrypted secret is not valid UTF-8.") from exc
