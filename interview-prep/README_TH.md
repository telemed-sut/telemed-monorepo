# 📖 Patient Management System - คู่มือภาษาไทย

> ⏱️ ใช้เวลาอ่าน: 30 นาที

---

## 🎯 ภาพรวมโปรเจค

**Patient Management System** คือระบบจัดการข้อมูลผู้ป่วย ประกอบด้วย:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Next.js   │ ──► │   FastAPI   │ ──► │ PostgreSQL  │
│  Frontend   │ JWT │   Backend   │ SQL │  Database   │
│  :3000      │     │   :8000     │     │   :5432     │
└─────────────┘     └─────────────┘     └─────────────┘
```

---

## 🛠️ Tech Stack ที่ใช้

| Layer | Technology | ทำไมถึงเลือก |
|-------|------------|-------------|
| **Frontend** | Next.js 15 + TypeScript | SSR, App Router ใหม่, Type-safe |
| **Backend** | FastAPI + Python | เร็ว, Auto Swagger docs, Async |
| **Database** | PostgreSQL | เสถียร, รองรับ UUID, Production-ready |
| **ORM** | SQLAlchemy | ป้องกัน SQL Injection, Migration support |
| **Auth** | JWT (python-jose) | Stateless, ปลอดภัย |
| **Containerization** | Docker Compose | One-click deploy, Reproducible |

---

## 📁 โครงสร้างโฟลเดอร์

```
back-take-home-test-requirement/
├── frontend/                 # Next.js App
│   ├── app/                  # Pages (App Router)
│   │   ├── login/           # หน้า Login
│   │   └── patients/        # หน้าจัดการผู้ป่วย
│   ├── components/          # React Components
│   ├── store/               # Zustand (State Management)
│   └── Dockerfile
│
├── backend/                  # FastAPI App
│   ├── app/
│   │   ├── api/             # HTTP Endpoints
│   │   │   ├── auth.py      # Login, Logout, Refresh
│   │   │   └── patients.py  # CRUD ผู้ป่วย
│   │   ├── models/          # Database Models
│   │   ├── schemas/         # Request/Response Validation
│   │   ├── services/        # Business Logic
│   │   └── core/            # Config, Security
│   ├── alembic/             # Database Migrations
│   ├── tests/               # Unit Tests
│   ├── scripts/seed.py      # Demo Data Seeder
│   └── Dockerfile
│
├── docker-compose.yml        # รัน 3 containers พร้อมกัน
└── README.md
```

---

## 🔐 ระบบ Authentication

### JWT Flow:
```
1. User ส่ง email + password  ──►  POST /auth/login
2. Server ตรวจสอบ            ──►  Hash password เทียบกับ DB
3. สร้าง JWT token           ──►  { user_id, role, exp }
4. ส่ง token กลับ            ──►  { access_token, token_type, expires_in }
5. Client เก็บ token         ──►  localStorage / Zustand
6. ส่ง token ทุก request     ──►  Authorization: Bearer <token>
```

### User Roles:
| Role | สิทธิ์ |
|------|-------|
| **Admin** | CRUD ทั้งหมด + ลบผู้ป่วยได้ |
| **Staff** | Create, Read, Update เท่านั้น |

---

## 📋 Patient CRUD Operations

| Method | Endpoint | หน้าที่ | Role |
|--------|----------|--------|------|
| `POST` | `/patients` | สร้างผู้ป่วยใหม่ | Admin, Staff |
| `GET` | `/patients` | ดูรายการ (pagination, search, sort) | Admin, Staff |
| `GET` | `/patients/{id}` | ดูรายละเอียด | Admin, Staff |
| `PUT` | `/patients/{id}` | แก้ไขข้อมูล | Admin, Staff |
| `DELETE` | `/patients/{id}` | ลบผู้ป่วย | **Admin เท่านั้น** |

### Patient Fields:
```python
id: UUID           # Primary Key
first_name: str    # ชื่อ (required)
last_name: str     # นามสกุล (required)
date_of_birth: date # วันเกิด (required)
gender: str        # เพศ (optional)
phone: str         # เบอร์โทร (optional)
email: str         # อีเมล (optional, validated)
address: str       # ที่อยู่ (optional)
created_at: datetime
updated_at: datetime
```

---

## 🛡️ Security Features

| Feature | วิธีทำ |
|---------|-------|
| **Password Hashing** | bcrypt + automatic salt |
| **JWT Tokens** | HMAC-SHA256, มี expiration |
| **Rate Limiting** | SlowAPI (ป้องกัน brute force) |
| **CORS** | Whitelist origins |
| **SQL Injection** | SQLAlchemy ORM (parameterized queries) |
| **Input Validation** | Pydantic schemas |

---

## 🐳 Docker Setup

### docker-compose.yml สร้าง 3 services:
```yaml
services:
  db:        # PostgreSQL database
  backend:   # FastAPI (รอ db พร้อมก่อน)
  frontend:  # Next.js (รอ backend พร้อม)
```

### รัน One-click:
```bash
docker compose up --build
```

### Ports:
- Frontend: http://localhost:3000
- Backend: http://localhost:8000
- Swagger: http://localhost:8000/docs

---

## 🧪 Testing

```bash
cd backend
pytest --cov=app

# ผลลัพธ์:
# test_auth.py        - ทดสอบ login/logout
# test_patients.py    - ทดสอบ CRUD
# test_role_based_access.py - ทดสอบ permissions
```

---

## 🔑 Demo Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@example.com | AdminPass123 |
| Staff | staff@example.com | StaffPass123 |

---

## ✅ Requirement Checklist

### Must-Have (ครบ 100%):
- [x] JWT Login
- [x] Protected Routes (401 on invalid token)
- [x] Patient CRUD
- [x] Pagination + Search + Sort
- [x] PostgreSQL + Alembic migrations
- [x] Docker Compose (one-click demo)
- [x] Seed demo data

### Nice-to-Have (Bonus):
- [x] Role-based access (Admin/Staff)
- [x] Rate limiting
- [x] Unit tests
- [x] GitHub Actions CI
- [x] Postman collection

---

**อ่านจบแล้ว ไปต่อที่ `interview_prep.md` ได้เลย! 📚**
