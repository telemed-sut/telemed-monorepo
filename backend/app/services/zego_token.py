import base64
import json
import random
import secrets
import struct
import time
from typing import Final


INT32_MAX: Final[int] = 2_147_483_647
AES_BLOCK_SIZE: Final[int] = 16
MAX_EFFECTIVE_TIME_IN_SECONDS: Final[int] = 24 * 24 * 60 * 60


class ZegoTokenGenerationError(RuntimeError):
    """Raised when ZEGO token04 generation cannot be completed."""


def _random_str(length: int) -> str:
    # Match ZEGOCLOUD reference implementation: mixed-case alnum.
    # Note: Some SDK versions seed random with created_at.
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
            "Invalid AES-CBC parameters. Expected server_secret to be 16/24/32 bytes and iv to be 16 bytes."
        ) from exc


def generate_token04(
    app_id: int,
    user_id: str,
    server_secret: str,
    effective_time_in_seconds: int,
    payload: str = "",
) -> str:
    """Generate ZEGO Token04.

    Format reference: ZEGOCLOUD `zego_server_assistant` Token04.
    Binary envelope (before base64):
      - expire_at: int64 big-endian (8 bytes)
      - iv_size: int16 big-endian (2 bytes)
      - iv: raw bytes (16 bytes)
      - ciphertext_size: int16 big-endian (2 bytes)
      - ciphertext: raw bytes (variable)
    """
    if app_id <= 0:
        raise ZegoTokenGenerationError("app_id must be > 0.")
    if not user_id:
        raise ZegoTokenGenerationError("user_id must not be empty.")
    if not server_secret:
        raise ZegoTokenGenerationError("server_secret must not be empty.")
    if len(server_secret) != 32:
        raise ZegoTokenGenerationError(
            "server_secret must be 32 characters (ZEGO app certificate)."
        )
    if effective_time_in_seconds <= 0:
        raise ZegoTokenGenerationError("effective_time_in_seconds must be > 0.")
    if effective_time_in_seconds > MAX_EFFECTIVE_TIME_IN_SECONDS:
        raise ZegoTokenGenerationError(
            "effective_time_in_seconds must be <= 24 days (2,073,600 seconds)."
        )

    created_at = int(time.time())
    expire_at = created_at + effective_time_in_seconds
    
    # Official Python SDK seeds random with created_at for deterministic IV/nonce in tests,
    # though any random values are valid. We follow the reference pattern for max compatibility.
    random.seed(created_at)
    nonce = random.randint(-2147483648, 2147483647)

    token_info = {
        "app_id": app_id,
        "user_id": user_id,
        "nonce": nonce,
        "ctime": created_at,
        "expire": expire_at,
        "payload": payload,
    }

    token_info_str = json.dumps(token_info, separators=(",", ":"))

    iv = _random_str(16)
    encrypted = _aes_encrypt(token_info_str, server_secret, iv)
    iv_bytes = iv.encode("utf8")

    result_size = len(encrypted) + 28
    result = bytearray(result_size)

    # 0-8: expire_at (int64)
    result[0:8] = struct.pack("!q", expire_at)
    
    # 8-10: iv_size (int16)
    result[8:10] = struct.pack("!h", len(iv_bytes))
    
    # 10-26: iv bytes
    result[10:26] = iv_bytes
    
    # 26-28: ciphertext_size (int16)
    result[26:28] = struct.pack("!h", len(encrypted))
    
    # 28+: ciphertext bytes
    result[28:] = encrypted

    return "04" + base64.b64encode(bytes(result)).decode("utf8")
