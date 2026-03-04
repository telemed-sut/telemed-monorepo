import base64
import json
import random
import struct
import time
from typing import Final


INT32_MAX: Final[int] = 2_147_483_647
AES_BLOCK_SIZE: Final[int] = 16
MAX_EFFECTIVE_TIME_IN_SECONDS: Final[int] = 24 * 24 * 60 * 60


class ZegoTokenGenerationError(RuntimeError):
    """Raised when ZEGO token04 generation cannot be completed."""


def _random_str(length: int) -> str:
    chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    return "".join(random.choice(chars) for _ in range(length))


def _pad_pkcs7(data: bytes, block_size: int) -> bytes:
    padding = block_size - (len(data) % block_size)
    return data + bytes([padding]) * padding


def _aes_encrypt(plain_text: str, key: str, iv: str) -> bytes:
    try:
        from Cryptodome.Cipher import AES  # type: ignore
    except ImportError as exc:
        raise ZegoTokenGenerationError(
            "Missing dependency 'pycryptodomex'. Install it to enable ZEGO token generation."
        ) from exc

    try:
        cipher = AES.new(key.encode("utf8"), AES.MODE_CBC, iv.encode("utf8"))
        return cipher.encrypt(_pad_pkcs7(plain_text.encode("utf8"), AES_BLOCK_SIZE))
    except ValueError as exc:
        raise ZegoTokenGenerationError(
            "Invalid ZEGO server secret length for AES-CBC. Expected 16/24/32 bytes."
        ) from exc


def generate_token04(
    app_id: int,
    user_id: str,
    server_secret: str,
    effective_time_in_seconds: int,
    payload: str = "",
) -> str:
    """Generate ZEGO token04 using the official binary envelope format."""
    if app_id <= 0:
        raise ZegoTokenGenerationError("app_id must be > 0.")
    if not user_id:
        raise ZegoTokenGenerationError("user_id must not be empty.")
    if not server_secret:
        raise ZegoTokenGenerationError("server_secret must not be empty.")
    if effective_time_in_seconds <= 0:
        raise ZegoTokenGenerationError("effective_time_in_seconds must be > 0.")
    if effective_time_in_seconds > MAX_EFFECTIVE_TIME_IN_SECONDS:
        raise ZegoTokenGenerationError(
            "effective_time_in_seconds must be <= 24 days (2,073,600 seconds)."
        )

    created_at = int(time.time())
    expire_at = created_at + effective_time_in_seconds

    token_info = {
        "app_id": app_id,
        "user_id": user_id,
        "nonce": random.randint(0, INT32_MAX),
        "ctime": created_at,
        "expire": expire_at,
    }
    if payload:
        token_info["payload"] = payload

    token_info_str = json.dumps(token_info, separators=(",", ":"))

    iv = _random_str(16)
    encrypted = _aes_encrypt(token_info_str, server_secret, iv)
    iv_bytes = iv.encode("utf8")

    token_bin = bytearray()
    token_bin.extend(struct.pack("!I", 0))
    token_bin.extend(struct.pack("!I", expire_at))
    token_bin.extend(struct.pack("!H", len(iv_bytes)))
    token_bin.extend(iv_bytes)
    token_bin.extend(struct.pack("!H", len(encrypted)))
    token_bin.extend(encrypted)

    return "04" + base64.b64encode(bytes(token_bin)).decode("utf8")
