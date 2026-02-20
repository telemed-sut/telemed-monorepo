import hmac
import hashlib
import time
import requests
import json
import os

from datetime import datetime

# Configuration
BASE_URL = os.getenv("PRESSURE_BASE_URL", "http://localhost:8000")
SECRET = os.getenv("DEVICE_API_SECRET", "change_this_to_a_strong_secret")
DEVICE_ID = os.getenv("DEVICE_ID", "test_device_001")
PATIENT_ID = os.getenv("PATIENT_ID", "721e584f-f3f9-4beb-81b0-bfc688e487ce")  # Valid test patient
REQUIRE_BODY_HASH = os.getenv("REQUIRE_BODY_HASH", "true").lower() == "true"
REQUIRE_NONCE = os.getenv("REQUIRE_NONCE", "true").lower() == "true"


def generate_headers(timestamp: str, body_hash: str | None = None, nonce: str | None = None):
    message = f"{timestamp}{DEVICE_ID}"
    if body_hash:
        message += body_hash
    if nonce:
        message += nonce
    signature = hmac.new(
        SECRET.encode(),
        message.encode(),
        hashlib.sha256
    ).hexdigest()

    headers = {
        "X-Device-Id": DEVICE_ID,
        "X-Timestamp": timestamp,
        "X-Signature": signature,
        "Content-Type": "application/json"
    }
    if body_hash:
        headers["X-Body-Hash"] = body_hash
    if nonce:
        headers["X-Nonce"] = nonce
    return headers


def test_create_pressure():
    payload = {
        "user_id": PATIENT_ID,
        "device_id": DEVICE_ID,
        "heart_rate": 75,
        "sys_rate": 120,
        "dia_rate": 80,
        "a": [1, 2, 3, 4, 5],
        "b": [5, 4, 3, 2, 1],
        "measured_at": datetime.now().isoformat()
    }
    payload_raw = json.dumps(payload, separators=(",", ":"))

    timestamp = str(int(time.time()))
    body_hash = hashlib.sha256(payload_raw.encode("utf-8")).hexdigest() if REQUIRE_BODY_HASH else None
    nonce = (
        hashlib.sha256(f"{DEVICE_ID}:{timestamp}:{os.urandom(8).hex()}".encode("utf-8")).hexdigest()[:32]
        if REQUIRE_NONCE
        else None
    )
    headers = generate_headers(timestamp, body_hash=body_hash, nonce=nonce)

    print(f"Sending request to {BASE_URL}/device/v1/pressure")
    try:
        response = requests.post(f"{BASE_URL}/device/v1/pressure", data=payload_raw, headers=headers)
        print(f"Status: {response.status_code}")
        print(f"Response: {response.text}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_create_pressure()
