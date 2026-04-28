import time
import hmac
import hashlib
import json
import urllib.request
import urllib.error

BASE_URL = "http://localhost:8000"

DEVICE_ID = "test_device_NEW_006"
DEVICE_SECRET = "k_CD6-FmznwKFCIFtZtXDlJawD3YTQonb2vMOtHFX-s" 
SESSION_ID = "0cc55779-3d7f-4c43-8942-a580592bc3ce"

def generate_signature(device_id: str, timestamp: str, secret: str) -> str:
    message = f"{timestamp}{device_id}"
    return hmac.new(
        secret.encode('utf-8'),
        message.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()

def simulate_pressure_data():
    endpoint = f"{BASE_URL}/device/v1/pressure"
    timestamp = str(int(time.time()))
    signature = generate_signature(DEVICE_ID, timestamp, DEVICE_SECRET)

    headers = {
        "Content-Type": "application/json",
        "X-Device-Id": DEVICE_ID,
        "X-Timestamp": timestamp,
        "X-Signature": signature
    }

    payload = {
        "device_id": DEVICE_ID,
        "session_id": SESSION_ID,
        "heart_rate": 75,
        "sys_rate": 120,
        "dia_rate": 80
    }

    payload = {k: v for k, v in payload.items() if v is not None}
    data = json.dumps(payload).encode('utf-8')
    
    req = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")

    print(f"🚀 จำลองการส่งข้อมูลจากเครื่อง {DEVICE_ID}...")
    try:
        with urllib.request.urlopen(req) as response:
            res_body = response.read().decode('utf-8')
            print(f"✅ สำเร็จ! (HTTP {response.status})")
            print(f"📦 Response: {res_body}")
            print("\n💡 หมายเหตุ: ตอนนี้ Session ของคุณน่าจะเปลี่ยนสถานะจาก pending_pair เป็น active แล้ว!")
            
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8')
        print(f"❌ เกิดข้อผิดพลาดจากเซิร์ฟเวอร์ (HTTP {e.code})")
        print(f"📦 Error Detail: {err_body}")
    except Exception as e:
        print(f"❌ ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้: {e}")

if __name__ == "__main__":
    simulate_pressure_data()
