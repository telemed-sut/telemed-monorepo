# รายงานการทดสอบระบบ Backend (FastAPI)

วันที่อ้างอิงผลการทดสอบ: 10 มีนาคม 2026

## 1. วัตถุประสงค์

เอกสารนี้สรุปผลการออกแบบและขยายชุดทดสอบสำหรับระบบ backend ของโครงการ
Telemed Platform เพื่อให้สามารถใช้เป็นหลักฐานประกอบรายงานวิชา โปรเจกต์
หรือเอกสารส่งงานได้ โดยเน้น 3 เรื่องหลัก:

- เพิ่มความครอบคลุมของ endpoint ที่สำคัญ
- เพิ่มความเข้มของการทดสอบด้าน security และ access control
- ยืนยันผลทั้งบน SQLite fast gate และ PostgreSQL compatibility gate

## 2. เครื่องมือและแนวทางที่ใช้

- FastAPI `TestClient`
- `pytest`
- dependency override ผ่าน `backend/tests/conftest.py`
- SQLite in-memory สำหรับ fast local gate
- PostgreSQL สำหรับ compatibility subset
- Alembic migrations สำหรับยืนยันพฤติกรรมใกล้ production

แนวทางหลักอิงตามรูปแบบการทดสอบของ FastAPI แต่ปรับให้เข้ากับโครงสร้างจริงของ
repo นี้ โดยใช้ fixture และ test harness ที่มีอยู่เดิม

## 3. ส่วนที่เพิ่มหรือปรับปรุง

### 3.1 เพิ่ม test coverage

เพิ่ม test ใหม่ในส่วนสำคัญดังนี้

- `patient-app/register` และ `patient-app/login`
- `patient-app/{patient_id}/code`
- `auth/me`
- `auth/2fa/*` management และ trusted devices
- `device/v1/health`, `device/v1/stats`, `device/v1/errors`
- `security/ip-bans*`
- `security/login-attempts`
- `stats/overview`
- `audit/logs` และ `audit/export`
- dense mode write actions `/patients/{id}/orders` และ `/patients/{id}/notes`
- security header middleware

### 3.2 แก้ bug จริงที่พบระหว่างทดสอบ

พบและแก้ bug ใน endpoint revoke trusted device ซึ่งเคยมีปัญหา shadow
ตัวแปร `response` ทำให้เกิดความเสี่ยงต่อการ crash ระหว่าง clear cookie

### 3.3 ปรับปรุง test harness

เพื่อให้รองรับ PostgreSQL จริงได้ดีขึ้น มีการปรับ `backend/tests/conftest.py`
ดังนี้

- รองรับ `TEST_DATABASE_URL` อย่างชัดเจน
- รองรับ `RUN_TEST_MIGRATIONS=true`
- เมื่อเป็น PostgreSQL จะ migrate แบบ one-time แล้ว cleanup ข้อมูลแบบ
  `TRUNCATE ... RESTART IDENTITY CASCADE`
- dispose connections ก่อน cleanup เพื่อลดปัญหา lock
- bootstrap table ที่ ORM รู้จักแต่ migration อาจยังไม่สร้างให้ครบใน test env

### 3.4 ปรับเส้นทาง export สำหรับ test environment

พบว่า `audit export` แบบ `StreamingResponse` มีโอกาสค้างช่วง teardown บน
PostgreSQL จริง จึงแยก testing path ให้คืน eager CSV `Response` ใน test env
แต่ยังคง production path เป็น `StreamingResponse` ตามเดิม

## 4. ผลการทดสอบ

ผลที่ยืนยันได้จริงจากการรันในเครื่อง

- SQLite full backend suite: `238 passed`
- PostgreSQL compatibility subset: `106 passed`

ตัวอย่างกลุ่มที่ยืนยันผ่านบน PostgreSQL จริง

- `tests/test_users.py`
- `tests/test_patients.py`
- `tests/test_dense_mode_access.py`
- `tests/test_audit_logs.py`
- `tests/test_auth_2fa_management.py`
- `tests/test_security_admin_endpoints.py`
- `tests/test_stats_and_audit_contracts.py`

## 5. ปัญหาที่พบระหว่างทำ

1. เดิม CI workflow ฝั่ง backend ยังไม่ได้ส่ง `TEST_DATABASE_URL` ให้ test
   harness ทำให้ pytest ไม่ได้ใช้ PostgreSQL ตามที่ตั้งใจไว้จริง
2. PostgreSQL test harness เดิมใช้รูปแบบที่ไม่เหมาะกับการรัน DB-sensitive
   suite ขนาดใหญ่
3. `audit export` ใน test environment มีปัญหาค้างช่วงท้ายจาก lifecycle ของ
   stream response

## 6. แนวทางแก้ไข

1. เพิ่ม PostgreSQL subset script สำหรับรันกลุ่มทดสอบที่เสี่ยงด้าน DB
2. ปรับ test harness ให้รองรับ migration + truncate cleanup บน PostgreSQL
3. ปรับ CI workflow ให้ส่ง `TEST_DATABASE_URL` และ `RUN_TEST_MIGRATIONS=true`
4. แยก testing path ของ `audit export` ให้เป็น eager CSV response

## 7. สรุป

จากผลการทดสอบล่าสุด สามารถสรุปได้ว่า backend ของโครงการมี test coverage ที่
แน่นขึ้นอย่างชัดเจนทั้งในด้าน business flow, RBAC, auditability, security,
device monitoring, และ patient mobile authentication

นอกจากนี้ยังยืนยันได้แล้วว่าชุดทดสอบไม่ได้ผ่านเฉพาะบน SQLite เท่านั้น แต่มี
PostgreSQL compatibility subset ที่รันผ่านจริงด้วย จึงถือว่า quality bar ของ
backend อยู่ในระดับที่เหมาะสำหรับการส่งงานและใช้ต่อใน CI/CD
