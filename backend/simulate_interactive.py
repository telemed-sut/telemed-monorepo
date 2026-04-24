import time
import hmac
import hashlib
import json
import urllib.request
import urllib.error
from app.db.session import SessionLocal
from app.models.device_exam_session import DeviceExamSession
from app.models.device_registration import DeviceRegistration

BASE_URL = "http://localhost:8000"

def generate_signature(device_id: str, timestamp: str, secret: str) -> str:
    message = f"{timestamp}{device_id}"
    return hmac.new(secret.encode('utf-8'), message.encode('utf-8'), hashlib.sha256).hexdigest()

def main():
    print("🔍 กำลังค้นหา Session ที่กำลังเปิดใช้งาน (pending_pair, active, stale)...")
    db = SessionLocal()
    # ดึง session ล่าสุดที่รอจับคู่หรือกำลังใช้งาน
    session = db.query(DeviceExamSession).filter(DeviceExamSession.status.in_(["pending_pair", "active", "stale"])).order_by(DeviceExamSession.created_at.desc()).first()
    
    if not session:
        print("❌ ไม่พบ Session ที่รอจับคู่เลย กรุณาไปกดสร้าง Session ในหน้าเว็บก่อนครับ")
        return
        
    device = db.query(DeviceRegistration).filter(DeviceRegistration.device_id == session.device_id).first()
    if not device or not device.device_secret:
        print(f"❌ ไม่พบข้อมูล Device Secret สำหรับเครื่อง {session.device_id}")
        return
        
    device_id = device.device_id
    device_secret = device.device_secret
    session_id = str(session.id)
    measurement_type = session.measurement_type.value
    
    print(f"\n✅ พบ Session รอจับคู่:")
    print(f"   - Session ID: {session_id}")
    print(f"   - Device ID: {device_id}")
    print(f"   - Measurement: {measurement_type}")
    
    if measurement_type == "blood_pressure":
        print(f"\n⚠️ หมายเหตุ: สคริปต์กำลังจะส่งข้อมูลความดันจำลองเข้าไป")
    else:
        print(f"\n⚠️ หมายเหตุ: สคริปต์กำลังจะส่งข้อมูล {measurement_type} จำลองเข้าไป")
    
    confirm = input("\n👉 กด Enter เพื่อส่งข้อมูลจำลองเข้าไปจับคู่เลย (หรือพิมพ์ n เพื่อยกเลิก): ")
    if confirm.lower() == 'n':
        print("ยกเลิกการส่งข้อมูล")
        return
        
    timestamp = str(int(time.time()))
    signature = generate_signature(device_id, timestamp, device_secret)

    headers = {
        "Content-Type": "application/json",
        "X-Device-Id": device_id,
        "X-Timestamp": timestamp,
        "X-Signature": signature
    }
    
    if measurement_type == "lung_sound":
        endpoint = f"{BASE_URL}/device/v1/lung-sounds"
        payload = {
            "device_id": device_id,
            "session_id": session_id,
            "position": 1,
            "duration_seconds": 10,
            "sample_rate_hz": 44100
        }
    elif measurement_type == "heart_sound":
        endpoint = f"{BASE_URL}/device/v1/heart-sounds"
        payload = {
            "mac_address": device_id,
            "session_id": session_id,
            "position": 1,
            "duration_seconds": 10,
            "blob_url": "https://example.com/demo.wav"
        }
    else:
        endpoint = f"{BASE_URL}/device/v1/pressure"
        payload = {
            "device_id": device_id,
            "session_id": session_id,
            "sys_rate": 120,
            "dia_rate": 80,
            "heart_rate": 75
        }

    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")

    print(f"\n🚀 กำลังส่งข้อมูลไปยัง {endpoint}...")
    try:
        with urllib.request.urlopen(req) as response:
            res_body = response.read().decode('utf-8')
            print(f"✅ จับคู่สำเร็จ! (HTTP {response.status})")
            print(f"📦 Response: {res_body}")
            print("\n💡 กลับไปดูที่หน้าเว็บได้เลยครับ สถานะเปลี่ยนเป็น 'กำลังใช้งาน (active)' ให้อัตโนมัติแล้ว!")
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8')
        print(f"❌ เกิดข้อผิดพลาดจากเซิร์ฟเวอร์ (HTTP {e.code})")
        print(f"📦 Error Detail: {err_body}")
    except Exception as e:
        print(f"❌ ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้: {e}")

if __name__ == "__main__":
    main()
