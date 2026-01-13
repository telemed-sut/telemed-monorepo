# 🎤 คำพูดเตรียม Review โค้ด - Take-home Test

> สถานการณ์: พี่เขาจะนั่งดูโค้ดด้วยกัน แล้วถามคำถามเกี่ยวกับสิ่งที่ทำ

---

## 📚 คำศัพท์สำคัญ + คำอ่าน

| คำภาษาอังกฤษ | คำอ่านภาษาไทย | ความหมาย |
|-------------|--------------|----------|
| FastAPI | ฟาสท์-เอ-พี-ไอ | Framework สำหรับ Backend |
| Next.js | เน็กซ์-เจเอส | Framework สำหรับ Frontend |
| PostgreSQL | โพสท์-เกรส-คิว-แอล | ฐานข้อมูล |
| JWT | เจ-ดับเบิ้ลยู-ที | JSON Web Token (โทเค็นสำหรับ login) |
| CRUD | ครัด | Create, Read, Update, Delete |
| Docker | ด็อก-เกอร์ | เครื่องมือรัน container |
| Docker Compose | ด็อก-เกอร์ คอม-โพส | รันหลาย container พร้อมกัน |
| SQLAlchemy | เอส-คิว-แอล-อัล-เคมี | ORM สำหรับ Python |
| Alembic | อะ-เลม-บิก | เครื่องมือ migration |
| Pydantic | ไพ-แดน-ติก | Library ตรวจสอบข้อมูล |
| bcrypt | บี-คริปต์ | วิธี hash password |
| Hash | แฮช | เข้ารหัสทางเดียว |
| Salt | ซอลท์ | ข้อมูลสุ่มเพิ่มความปลอดภัย |
| Token | โทเค็น | รหัสผ่านชั่วคราว |
| Endpoint | เอ็น-พอยท์ | จุดเชื่อมต่อ API |
| Pagination | เพ-จิ-เน-ชั่น | แบ่งหน้า |
| Middleware | มิด-เดิล-แวร์ | ตัวกลางประมวลผล |
| Swagger | สแวก-เกอร์ | เครื่องมือดู API docs |
| UUID | ยู-ยู-ไอ-ดี | รหัสเฉพาะไม่ซ้ำกัน |
| Rate Limiting | เรท-ลิ-มิ-ติ้ง | จำกัดจำนวน request |
| Brute Force | บรูท-ฟอร์ส | โจมตีด้วยการลองเรื่อยๆ |
| Environment | เอ็น-ไว-รอน-เม้นท์ | ตัวแปรสภาพแวดล้อม |
| Dependencies | ดี-เพ็น-เด็น-ซี่ | สิ่งที่ต้องพึ่งพา |
| Repository | รี-โพ-ซิ-ทอ-รี่ | ที่เก็บโค้ด |
| Migration | ไม-เกร-ชั่น | การเปลี่ยนแปลง database |
| Seed | ซีด | ข้อมูลเริ่มต้น |
| Schema | สกี-มา | โครงสร้างข้อมูล |
| Query | ควี-รี่ | คำสั่งดึงข้อมูล |
| Authentication | ออ-เธน-ติ-เค-ชั่น | การยืนยันตัวตน |
| Authorization | ออ-ธอ-ไร-เซ-ชั่น | การอนุญาตสิทธิ์ |
| Role-based | โรล-เบส | ตามบทบาท |
| Admin | แอด-มิน | ผู้ดูแลระบบ |
| Staff | สตาฟ | พนักงาน |

---

## 🌟 เปิดมา (ถ้าให้แนะนำโปรเจค)

> "โปรเจคนี้ผม/หนูทำระบบ **Patient Management** (เพ-เชี่ยน แมเนจ-เม้นท์) ตามโจทย์ครับ/ค่ะ
> 
> ใช้ **Next.js** (เน็กซ์-เจเอส) ฝั่ง Frontend (ฟร้อนท์-เอ็น)
> 
> **FastAPI** (ฟาสท์-เอ-พี-ไอ) ฝั่ง Backend (แบ็ค-เอ็น)
> 
> และ **PostgreSQL** (โพสท์-เกรส-คิว-แอล) เป็น Database (ดา-ต้า-เบส)
> 
> ทำครบตาม requirement คือ JWT Login (เจ-ดับเบิ้ลยู-ที ล็อก-อิน), Patient CRUD (ครัด), Pagination (เพ-จิ-เน-ชั่น), Search (เสิร์ช)
> 
> และรันได้ด้วย `docker compose up --build` (ด็อก-เกอร์ คอม-โพส อัพ บิลด์) ครับ/ค่ะ"

---

## 🎯 ถ้าพี่ถาม "อธิบายระบบหน่อยว่าทำอะไรไปบ้าง"

### แบบสั้น (1-2 นาที):

> "ระบบนี้ทำ 4 ส่วนหลักครับ/ค่ะ:
>
> **1. Authentication (ออ-เธน-ติ-เค-ชั่น)** - ระบบ login ด้วย JWT
> - User ส่ง email + password มา
> - Server เช็คแล้วสร้าง token ส่งกลับ
> - Token ต้องแนบมาทุก request ที่ protected
>
> **2. Patient CRUD (ครัด)** - จัดการข้อมูลผู้ป่วย
> - Create (สร้าง) - เพิ่มผู้ป่วยใหม่
> - Read (อ่าน) - ดูรายการ + ดูรายละเอียด
> - Update (แก้ไข) - แก้ไขข้อมูล
> - Delete (ลบ) - ลบผู้ป่วย (เฉพาะ Admin)
>
> **3. Features เสริม**
> - Pagination (แบ่งหน้า)
> - Search (ค้นหา)
> - Role-based access (Admin กับ Staff)
>
> **4. Docker** - รันได้ด้วยคำสั่งเดียว
> ครับ/ค่ะ"

---

### แบบละเอียด (3-5 นาที) - ถ้าพี่อยากฟังเพิ่ม:

> "ผม/หนูจะอธิบายทีละส่วนนะครับ/ค่ะ:
>
> ---
>
> **ส่วนที่ 1: Authentication (ระบบยืนยันตัวตน)**
>
> เมื่อ user กด login หน้าเว็บ:
> 1. Frontend ส่ง email + password ไปที่ `/auth/login`
> 2. Backend เอา password มาเทียบกับ hash ใน database
> 3. ถ้าถูกต้อง สร้าง JWT token ที่มี user_id + role + เวลาหมดอายุ
> 4. ส่ง token กลับไปให้ Frontend เก็บไว้
> 5. ทุก request หลังจากนั้น ต้องแนบ token มาใน header
> 6. ถ้า token ไม่ถูกต้องหรือหมดอายุ จะได้ 401 Unauthorized กลับไป
>
> Password ไม่ได้เก็บ plaintext นะครับ/ค่ะ ใช้ bcrypt hash ครับ/ค่ะ
>
> ---
>
> **ส่วนที่ 2: Patient CRUD (จัดการข้อมูลผู้ป่วย)**
>
> มี 5 API endpoints:
> - `POST /patients` - สร้างผู้ป่วยใหม่
> - `GET /patients` - ดูรายการ (มี pagination, search, sort)
> - `GET /patients/{id}` - ดูรายละเอียดคนเดียว
> - `PUT /patients/{id}` - แก้ไขข้อมูล
> - `DELETE /patients/{id}` - ลบ (เฉพาะ Admin ทำได้)
>
> ทุก endpoint ต้องมี token ถึงจะเข้าได้ครับ/ค่ะ
>
> ---
>
> **ส่วนที่ 3: Role-based Access (แบ่งสิทธิ์)**
>
> มี 2 roles:
> - **Admin** - ทำได้ทุกอย่างรวมถึงลบ
> - **Staff** - ทำได้ทุกอย่างยกเว้นลบ
>
> ถ้า Staff พยายามลบ จะได้ 403 Forbidden ครับ/ค่ะ
>
> ---
>
> **ส่วนที่ 4: Database + Migration**
>
> ใช้ PostgreSQL เก็บข้อมูล 2 tables:
> - `users` - เก็บ email, password_hash, role
> - `patients` - เก็บข้อมูลผู้ป่วย
>
> ใช้ Alembic จัดการ migration
> ตอน Docker start จะรัน migration + seed ข้อมูลตัวอย่างอัตโนมัติครับ/ค่ะ
>
> ---
>
> **ส่วนที่ 5: Docker Compose**
>
> รันด้วย `docker compose up --build` คำสั่งเดียว
> สร้าง 3 containers:
> 1. Database (PostgreSQL)
> 2. Backend (FastAPI)
> 3. Frontend (Next.js)
>
> ครับ/ค่ะ"

---

## 📊 ถ้าพี่ถาม "Flow การทำงานเป็นยังไง"

> "Flow หลักครับ/ค่ะ:
>
> ```
> User เปิดเว็บ → หน้า Login
>       ↓
> กรอก email + password → กด Login
>       ↓
> Frontend ส่งไป Backend → POST /auth/login
>       ↓
> Backend เช็ค password → สร้าง JWT token
>       ↓
> ส่ง token กลับ → Frontend เก็บไว้
>       ↓
> Redirect ไปหน้า Patient List
>       ↓
> Frontend เรียก GET /patients (แนบ token)
>       ↓
> Backend เช็ค token → ดึงข้อมูลจาก DB
>       ↓
> ส่งรายการผู้ป่วยกลับมาแสดง
> ```
>
> ครับ/ค่ะ"

---

## 📋 ถ้าพี่ถาม "ทำครบตาม Requirement ไหม"

> "ทำครบตาม requirement ครับ/ค่ะ:
>
> **Must-Have (ต้องมี):**
> - ✅ JWT Login - มีครับ/ค่ะ
> - ✅ Protected Routes - ต้องมี token ถึงเข้าได้
> - ✅ 401 เมื่อ token ไม่ถูกต้อง - มีครับ/ค่ะ
> - ✅ Patient CRUD - ครบ 5 endpoints
> - ✅ Pagination + Search + Sort - มีครับ/ค่ะ
> - ✅ PostgreSQL + Alembic - มีครับ/ค่ะ
> - ✅ Docker Compose - รันคำสั่งเดียว
> - ✅ Seed Data - มี demo users + patients
>
> **Bonus (ทำเพิ่ม):**
> - ✅ Role-based access - Admin กับ Staff
> - ✅ Rate Limiting - ป้องกัน brute force
> - ✅ Unit Tests - มี 4 ไฟล์
> - ✅ GitHub Actions CI
>
> ครับ/ค่ะ"

---

## 🔍 เมื่อพี่ถามเกี่ยวกับโค้ด

### "ทำไมเลือก Tech Stack (เทค-สแต็ค) นี้?"

> "เลือก **FastAPI** (ฟาสท์-เอ-พี-ไอ) เพราะตาม requirement (รี-ไคว-เม้นท์) แนะนำมาครับ/ค่ะ 
> 
> และมันเร็ว มี **Swagger docs** (สแวก-เกอร์ ด็อกส์) อัตโนมัติ
> 
> ส่วน **Next.js** (เน็กซ์-เจเอส) เพราะ requirement บอกให้ใช้ และรองรับ **TypeScript** (ไทป์-สคริปต์) ดีครับ/ค่ะ"

### "อธิบาย JWT Authentication (เจ-ดับเบิ้ลยู-ที ออ-เธน-ติ-เค-ชั่น) หน่อย"

> "ผม/หนูใช้ library **python-jose** (ไพธอน-โฮเซ่) สร้าง JWT (เจ-ดับเบิ้ลยู-ที) ครับ/ค่ะ
> 
> ตอน login (ล็อก-อิน) จะเช็ค password (พาส-เวิร์ด) ด้วย **bcrypt** (บี-คริปต์)
> 
> แล้วสร้าง token (โทเค็น) ที่มี user_id กับ role (โรล)
> 
> Token หมดอายุใน 1 ชั่วโมง ตาม JWT_EXPIRES_IN ที่ตั้งไว้ครับ/ค่ะ
> 
> ดูได้ที่ไฟล์ `security.py` (ซี-เคียว-ริ-ตี้ พาย) ครับ/ค่ะ"

### "Password (พาส-เวิร์ด) เก็บยังไง?"

> "ใช้ **bcrypt hash** (บี-คริปต์ แฮช) ครับ/ค่ะ ไม่ได้เก็บ plaintext (เพลน-เท็กซ์)
> 
> ใช้ library **passlib** (พาส-ลิบ) ที่ hash พร้อม **salt** (ซอลท์) อัตโนมัติครับ/ค่ะ"

### "โครงสร้างโค้ด Backend (แบ็ค-เอ็น) เป็นยังไง?"

> "แบ่งเป็น layers (เลเยอร์) ครับ/ค่ะ:
> 
> - `api/` - HTTP endpoints (เอ็น-พอยท์) รับ request (รี-เควสท์)
> - `services/` (เซอร์-วิส) - business logic (บิส-เนส ลอ-จิก)
> - `models/` (โม-เดล) - database models
> - `schemas/` (สกี-มา) - validation (วา-ลิ-เด-ชั่น) ด้วย **Pydantic** (ไพ-แดน-ติก)
> - `core/` (คอร์) - config (คอน-ฟิก) และ security (ซี-เคียว-ริ-ตี้)
> 
> แยกแบบนี้เพื่อให้ test (เทสต์) ง่าย และแยก responsibilities (รี-สปอน-ซิ-บิ-ลิ-ตี้) ชัดเจนครับ/ค่ะ"

### "Pagination (เพ-จิ-เน-ชั่น) ทำยังไง?"

> "ใช้ query params (ควี-รี่ พา-แรม) `page` กับ `limit` ครับ/ค่ะ
> 
> ใน service จะ calculate (แคล-คู-เลท) offset (ออฟ-เซ็ท) แล้ว query ด้วย **SQLAlchemy** (เอส-คิว-แอล-อัล-เคมี)
> 
> return มาเป็น `{ items, page, limit, total }` ครับ/ค่ะ"

### "Search (เสิร์ช) ทำยังไง?"

> "รับ query param `q` แล้วใช้ SQL **ILIKE** (ไอ-ไลค์) ค้นหาใน first_name, last_name, email, phone ครับ/ค่ะ
> 
> ใช้ `or_()` ใน SQLAlchemy เพื่อค้นหาหลาย field (ฟิลด์) ครับ/ค่ะ"

### "ทำไมใช้ UUID (ยู-ยู-ไอ-ดี) แทน auto-increment (ออ-โต้ อิน-ครี-เม้นท์)?"

> "เพราะปลอดภัยกว่าครับ/ค่ะ ไม่โชว์ว่ามีกี่ records (เร-คอร์ด)
> 
> และรองรับ distributed systems (ดิส-ทริ-บิว-เท็ด ซิส-เท็ม) ถ้าต้องการ scale (สเกล) ในอนาคตครับ/ค่ะ"

### "Docker Compose (ด็อก-เกอร์ คอม-โพส) ทำงานยังไง?"

> "มี 3 services (เซอร์-วิส) ครับ/ค่ะ:
> 
> 1. `db` - **PostgreSQL** (โพสท์-เกรส)
> 2. `backend` (แบ็ค-เอ็น) - FastAPI, ใช้ `depends_on` (ดี-เพ็นส์-ออน) รอ db พร้อมก่อน
> 3. `frontend` (ฟร้อนท์-เอ็น) - Next.js
> 
> ตอน backend start จะรัน **migration** (ไม-เกร-ชั่น) แล้ว **seed** (ซีด) data อัตโนมัติครับ/ค่ะ"

### "Alembic (อะ-เลม-บิก) / Migration (ไม-เกร-ชั่น) ใช้ยังไง?"

> "**Alembic** (อะ-เลม-บิก) เป็น migration tool (ไม-เกร-ชั่น ทูล) ครับ/ค่ะ
> 
> ไฟล์ migration อยู่ที่ `alembic/versions/`
> 
> ตอน Docker start จะรัน `alembic upgrade head` (อะ-เลม-บิก อัพ-เกรด เฮด) อัตโนมัติครับ/ค่ะ"

### "Role-based access (โรล-เบส แอ็ค-เซส) ทำยังไง?"

> "มี 2 roles คือ **Admin** (แอด-มิน) กับ **Staff** (สตาฟ) ครับ/ค่ะ
> 
> Admin ทำได้ทุกอย่าง แต่ Staff ลบไม่ได้
> 
> ใช้ dependency (ดี-เพ็น-เด็น-ซี่) `get_admin_user` ตรวจสอบ role ก่อน delete (ดี-ลีท) ครับ/ค่ะ"

### "Rate Limiting (เรท-ลิ-มิ-ติ้ง) ทำไปทำไม?"

> "เพิ่มเป็น bonus (โบ-นัส) ครับ/ค่ะ ป้องกัน **brute force attack** (บรูท-ฟอร์ส แอท-แทค)
> 
> Login จำกัด 10 ครั้ง/นาที ใช้ library **SlowAPI** (สโลว์-เอ-พี-ไอ) ครับ/ค่ะ"

### "มี Test (เทสต์) อะไรบ้าง?"

> "มี **unit tests** (ยู-นิท เทสต์) ใน folder `tests/` ครับ/ค่ะ
> 
> - test_auth.py - ทดสอบ login
> - test_patients.py - ทดสอบ CRUD (ครัด)
> - test_role_based_access.py - ทดสอบ permissions (เพอร์-มิช-ชั่น)
> 
> รันด้วย `pytest` (ไพ-เทสต์) ครับ/ค่ะ"

---

## 😰 ถ้าไม่รู้คำตอบ

> "ตรงนี้ผม/หนูยังไม่แม่นครับ/ค่ะ ขอเปิดดูโค้ดได้ไหมครับ/ค่ะ?"

หรือ

> "ตรงนี้ผม/หนูยังไม่ได้ศึกษาลึกครับ/ค่ะ แต่จะไปศึกษาเพิ่มเติมครับ/ค่ะ"

---

## ❓ คำถามที่ควรถามพี่ตอนจบ

> "อยากถามว่า:
> 
> 1. ถ้าได้เข้าฝึกงาน จะได้ทำ project (โปร-เจค) แบบไหนครับ/ค่ะ?
> 2. ทีมใช้ tech stack (เทค-สแต็ค) อะไรบ้างครับ/ค่ะ?
> 3. มีอะไรที่ผม/หนูควรไปศึกษาเพิ่มไหมครับ/ค่ะ?"

---

## ⚡ Demo Credentials (เดโม ครี-เด็น-เชียล) - ท่องไว้

```
Admin (แอด-มิน): admin@example.com / AdminPass123
Staff (สตาฟ): staff@example.com / StaffPass123

รัน: docker compose up --build
(ด็อก-เกอร์ คอม-โพส อัพ บิลด์)
```

---

**สู้ๆ ครับ/ค่ะ! ทำมาดีมาก เตรียมตัวไป review (รี-วิว) ได้เลย! 💪**
