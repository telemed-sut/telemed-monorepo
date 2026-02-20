import hmac
import hashlib
import time
import requests
import json
import uuid

from datetime import datetime

# Configuration
BASE_URL = "http://localhost:8000"
SECRET = "change_this_to_a_strong_secret"
DEVICE_ID = "test_device_001"
PATIENT_ID = "721e584f-f3f9-4beb-81b0-bfc688e487ce"  # Valid test patient

def generate_headers(timestamp: str):
    message = f"{timestamp}{DEVICE_ID}"
    signature = hmac.new(
        SECRET.encode(),
        message.encode(),
        hashlib.sha256
    ).hexdigest()
    
    return {
        "X-Device-Id": DEVICE_ID,
        "X-Timestamp": timestamp,
        "X-Signature": signature,
        "Content-Type": "application/json"
    }

def test_create_pressure():
    timestamp = str(int(time.time()))
    headers = generate_headers(timestamp)
    
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

    print(f"Sending request to {BASE_URL}/device/v1/pressure")
    try:
        response = requests.post(f"{BASE_URL}/device/v1/pressure", json=payload, headers=headers)
        print(f"Status: {response.status_code}")
        print(f"Response: {response.text}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_create_pressure()
