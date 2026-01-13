# 📋 Interview Preparation: Patient Management System

> ⏱️ ใช้เวลาอ่าน: 1-2 ชั่วโมง

เอกสารเตรียมตัวสำหรับการ review โค้ดและสัมภาษณ์ฝึกงาน

---

## 🎯 คำถามที่อาจถูกถาม + แนวตอบ

### 1. Architecture & Design

**Q: ทำไมเลือกใช้ FastAPI?**
> FastAPI เร็วกว่า Flask/Django มาก เพราะใช้ async และมี automatic API documentation (Swagger) built-in รองรับ Pydantic สำหรับ validation ทำให้โค้ดสะอาดและ type-safe

**Q: ทำไมใช้ SQLAlchemy แทน raw SQL?**
> SQLAlchemy เป็น ORM ช่วยป้องกัน SQL Injection อัตโนมัติ และทำให้โค้ดอ่านง่าย maintain ง่าย รองรับ migration ผ่าน Alembic

**Q: โครงสร้างโปรเจคเป็นยังไง?**
> แบ่งเป็น layers ชัดเจน:
> - `api/` - HTTP handlers (routes)
> - `services/` - business logic
> - `models/` - database models (SQLAlchemy)
> - `schemas/` - request/response validation (Pydantic)
> - `core/` - config และ security utilities

**Q: ทำไมแยก services กับ api?**
> เป็น Separation of Concerns:
> - `api/` รับ HTTP request, validate, ส่ง response
> - `services/` ทำ business logic, เรียก database
> ทำให้ test ง่าย และ reuse code ได้

---

### 2. Authentication & Security

**Q: JWT ทำงานยังไง?**
> 1. User ส่ง email + password มา `/auth/login`
> 2. Server ตรวจสอบ credential ถ้าถูกต้องสร้าง JWT token
> 3. Token ประกอบด้วย: user_id, role, exp (expiration time)
> 4. Client เก็บ token ไว้แล้วส่งใน header `Authorization: Bearer <token>`
> 5. Server verify token ทุก request ที่ protected

**Q: JWT มีข้อมูลอะไรบ้าง?**
> - `sub` (subject): user ID
> - `role`: admin หรือ staff
> - `exp`: expiration timestamp
> - ถูก sign ด้วย secret key (HMAC-SHA256)

**Q: Password เก็บยังไง?**
> ใช้ **bcrypt** hash พร้อม salt ไม่เก็บ plaintext password เด็ดขาด ดูได้ที่ `app/core/security.py`

**Q: Rate Limiting ทำไปทำไม?**
> ป้องกัน:
> - Brute force attack (login 10 ครั้ง/นาที)
> - DDoS attack
> - API abuse
> ใช้ SlowAPI library ดูได้ที่ `app/main.py`

**Q: CORS คืออะไร ทำไมต้องมี?**
> Cross-Origin Resource Sharing - กำหนดว่า domain ไหนบ้างที่สามารถเรียก API ได้ ป้องกัน malicious websites เรียก API โดยไม่ได้รับอนุญาต

**Q: ถ้า token หมดอายุ ทำยังไง?**
> - Client จะได้ 401 Unauthorized
> - Redirect ไป login page
> - หรือใช้ `/auth/refresh` เพื่อขอ token ใหม่ (ถ้า token ยังไม่หมดอายุ)

---

### 3. Database & Migrations

**Q: Alembic ใช้ทำอะไร?**
> จัดการ database migrations - track การเปลี่ยนแปลง schema เหมือน Git สำหรับ database สามารถ upgrade/downgrade version ได้

**Q: ทำไม Patient ใช้ UUID แทน auto-increment?**
> - ปลอดภัยกว่า (ไม่โชว์ว่ามีกี่ records)
> - รองรับ distributed systems
> - ไม่ต้องรอ DB generate ID
> - URL ดู professional กว่า

**Q: ทำไมมี created_at และ updated_at?**
> Audit trail - รู้ว่า record ถูกสร้างและแก้ไขเมื่อไหร่ `updated_at` อัพเดทอัตโนมัติเมื่อ update record

**Q: Database index ใช้ที่ไหน?**
> ใส่ index ที่:
> - `first_name`, `last_name` - ค้นหาบ่อย
> - `email`, `phone` - ค้นหาบ่อย
> ดูได้ที่ `app/models/patient.py`

---

### 4. Frontend (Next.js)

**Q: ทำไมใช้ Next.js?**
> - Server-side rendering (SEO friendly)
> - App Router ใหม่ (Next.js 15)
> - Built-in routing
> - TypeScript support
> - Easy deployment to Vercel

**Q: Token เก็บที่ไหน?**
> ใช้ Zustand store + persist to localStorage ดูได้ที่ `store/auth-store.ts`

**Q: ทำไมใช้ Zustand ไม่ใช่ Redux?**
> Zustand เบากว่า, เขียนง่ายกว่า, ไม่ต้อง boilerplate เยอะ เหมาะกับโปรเจคขนาดเล็ก-กลาง

**Q: ถ้า token หมดอายุทำยังไง?**
> ใช้ middleware check token validity ถ้า expired redirect ไป login page

---

### 5. Docker & DevOps

**Q: Docker Compose ทำงานยังไง?**
> สร้าง 3 containers:
> 1. `postgres` - database
> 2. `backend` - FastAPI (รอ DB พร้อมก่อนเริ่ม)
> 3. `frontend` - Next.js (รอ backend พร้อม)
>
> ใช้ `depends_on` กำหนดลำดับ

**Q: ทำไมใช้ multi-stage build ใน Dockerfile?**
> ลดขนาด image สุดท้าย:
> - Stage 1 (deps): install dependencies
> - Stage 2 (builder): build app
> - Stage 3 (runner): production image (เฉพาะที่จำเป็น)
> ลด image size จาก ~1GB → ~200MB

**Q: Environment variables จัดการยังไง?**
> ใช้ `.env` file และ Pydantic Settings class validate ค่า auto ดูที่ `app/core/config.py`

**Q: ทำไมต้อง EXPOSE port?**
> บอก Docker ว่า container นี้ใช้ port อะไร ช่วยให้ docker-compose map ports ได้

---

### 6. Testing

**Q: มี test อะไรบ้าง?**
> - `test_auth.py` - ทดสอบ login/logout
> - `test_patients.py` - ทดสอบ CRUD
> - `test_role_based_access.py` - ทดสอบ admin vs staff permissions
> - `test_api.py` - ทดสอบ API endpoints

**Q: รัน test ยังไง?**
> ```bash
> cd backend
> pytest --cov=app
> ```

**Q: ใช้ test framework อะไร?**
> pytest + httpx (async HTTP client for testing FastAPI)

---

### 7. Code Quality

**Q: Error handling ทำยังไง?**
> - ใช้ HTTPException ส่ง proper status codes (400, 401, 403, 404, 422)
> - Pydantic validation errors return 422 พร้อม detail
> - Custom exception handlers ดูที่ `main.py`

**Q: Validation ทำที่ไหน?**
> 3 layers:
> 1. Request validation: Pydantic schemas (`schemas/`)
> 2. Business logic: Service layer (`services/`)
> 3. Database constraints: SQLAlchemy models (`models/`)

**Q: HTTP Status Codes ที่ใช้?**
| Code | ใช้ตอน |
|------|--------|
| 200 | Success |
| 201 | Created |
| 204 | No Content (delete success) |
| 400 | Bad Request |
| 401 | Unauthorized (no/invalid token) |
| 403 | Forbidden (no permission) |
| 404 | Not Found |
| 422 | Validation Error |
| 429 | Too Many Requests (rate limit) |

---

## 🔥 สิ่งที่ควรจำไว้ตอบ

### Must-Have ที่ทำครบ:
1. ✅ JWT authentication (login, protected routes, 401 handling)
2. ✅ Patient CRUD (Create, Read, Update, Delete)
3. ✅ Pagination + Search + Sort
4. ✅ PostgreSQL + Alembic migrations
5. ✅ Docker Compose one-click demo
6. ✅ Seed data (demo users + sample patients)

### Bonus ที่ทำเพิ่ม:
1. ✅ Role-based access (Admin/Staff)
2. ✅ Rate limiting (ป้องกัน abuse)
3. ✅ Unit tests
4. ✅ GitHub Actions CI
5. ✅ Postman collection

---

## 📁 ไฟล์สำคัญที่ควรรู้

| ไฟล์ | หน้าที่ | เปิดดูเมื่อถูกถาม |
|------|---------|-----------------|
| `backend/app/main.py` | Entry point, CORS, Rate limiting | ถามเรื่อง setup |
| `backend/app/api/auth.py` | Login, Logout, Refresh | ถามเรื่อง auth |
| `backend/app/api/patients.py` | Patient CRUD | ถามเรื่อง CRUD |
| `backend/app/core/security.py` | JWT & Password | ถามเรื่อง security |
| `backend/app/models/patient.py` | Database model | ถามเรื่อง DB |
| `backend/scripts/seed.py` | Demo data seeder | ถามเรื่อง seed |
| `docker-compose.yml` | Container orchestration | ถามเรื่อง Docker |

---

## ❓ คำถามที่อาจถามกลับพี่

1. "ทีมใช้ tech stack อะไรบ้างครับ?"
2. "มี code review process ยังไงครับ?"
3. "ฝึกงานจะได้ทำ project แบบไหนครับ?"
4. "มี mentor ดูแลไหมครับ?"

---

**อ่านจบแล้ว ไปต่อที่ `pre_interview_guide.md` 📖**
