import base64
import struct

import pytest

from app.services import zego_token


def test_generate_token04_binary_layout(monkeypatch):
    monkeypatch.setattr(zego_token.random, "randint", lambda _a, _b: 7)
    monkeypatch.setattr(zego_token.time, "time", lambda: 1_700_000_000)
    monkeypatch.setattr(zego_token, "_random_str", lambda _length: "A" * 16)
    monkeypatch.setattr(
        zego_token,
        "_aes_encrypt",
        lambda _plain_text, _key, _iv: b"CIPHERTEXT",
    )

    token = zego_token.generate_token04(
        app_id=1477525628,
        user_id="doctor-1",
        server_secret="92010c8a7aa686718d08b4ff247e462f",
        effective_time_in_seconds=900,
        payload="",
    )

    assert token.startswith("04")
    raw = base64.b64decode(token[2:])

    cursor = 0
    reserved, = struct.unpack_from("!I", raw, cursor)
    cursor += 4
    expire, = struct.unpack_from("!I", raw, cursor)
    cursor += 4
    iv_len, = struct.unpack_from("!H", raw, cursor)
    cursor += 2
    iv = raw[cursor:cursor + iv_len]
    cursor += iv_len
    cipher_len, = struct.unpack_from("!H", raw, cursor)
    cursor += 2
    cipher = raw[cursor:cursor + cipher_len]

    assert reserved == 0
    assert expire == 1_700_000_900
    assert iv == b"AAAAAAAAAAAAAAAA"
    assert cipher == b"CIPHERTEXT"


def test_generate_token04_rejects_expiry_over_24_days():
    with pytest.raises(zego_token.ZegoTokenGenerationError):
        zego_token.generate_token04(
            app_id=1477525628,
            user_id="doctor-1",
            server_secret="92010c8a7aa686718d08b4ff247e462f",
            effective_time_in_seconds=2_073_601,
            payload="",
        )
