# ⚡ Quick Cheatsheet - ทบทวน 15 นาทีก่อนสัมภาษณ์

---

## 🔑 Demo Credentials
```
Admin: admin@example.com / AdminPass123
Staff: staff@example.com / StaffPass123
```

---

## 🚀 Quick Commands
```bash
# รัน demo
docker compose up --build

# URLs
Frontend: http://localhost:3000
Swagger:  http://localhost:8000/docs

# ถ้า Docker พัง
cd backend && uvicorn app.main:app --reload
cd frontend && npm run dev
```

---

## 📋 Tech Stack Summary
| Layer | Tech |
|-------|------|
| Frontend | Next.js 15 + TypeScript |
| Backend | FastAPI + Python |
| Database | PostgreSQL |
| ORM | SQLAlchemy + Alembic |
| Auth | JWT (bcrypt hash) |
| Deploy | Docker Compose |

---

## 🔐 JWT Flow (4 ขั้นตอน)
```
1. POST /auth/login → ส่ง email + password
2. Server verify → hash เทียบ DB
3. สร้าง JWT → { user_id, role, exp }
4. Client ส่ง → Authorization: Bearer <token>
```

---

## 📁 ไฟล์สำคัญ
| ถูกถามเรื่อง | เปิดไฟล์ |
|------------|---------|
| Setup/CORS/Rate limit | `main.py` |
| Auth/JWT | `core/security.py` |
| Login endpoint | `api/auth.py` |
| Patient CRUD | `api/patients.py` |
| DB Model | `models/patient.py` |
| Docker | `docker-compose.yml` |

---

## 🛡️ Security Features (6 อย่าง)
1. ✅ bcrypt password hash
2. ✅ JWT tokens (HMAC-SHA256)
3. ✅ Rate limiting (SlowAPI)
4. ✅ CORS protection
5. ✅ SQL Injection protection (ORM)
6. ✅ Role-based access (Admin/Staff)

---

## 📊 Rate Limits
| Endpoint | Limit |
|----------|-------|
| Login | 10/min (brute force) |
| CRUD Read | 60/min |
| CRUD Write | 30/min |
| Delete | 20/min |

---

## ✅ Completed Requirements
### Must-Have (100%)
- [x] JWT Login + Protected Routes
- [x] Patient CRUD + Pagination + Search
- [x] PostgreSQL + Alembic
- [x] Docker Compose (one-click)
- [x] Seed demo data

### Bonus
- [x] Role-based (Admin/Staff)
- [x] Rate limiting
- [x] Unit tests
- [x] GitHub Actions CI

---

## 🗣️ Key Phrases
> "ผมเลือก FastAPI เพราะเร็ว มี Swagger อัตโนมัติ"

> "Password hash ด้วย bcrypt ไม่เก็บ plaintext"

> "ใช้ SQLAlchemy ป้องกัน SQL Injection"

> "Rate limiting ป้องกัน brute force attack"

> "Docker Compose รัน 3 containers พร้อมกัน"

---

## 😰 ถ้าลืม/ไม่รู้
> "ขออนุญาตเปิดดูโค้ดนะครับ"

> "ตรงนี้ยังไม่แม่น แต่จะไปศึกษาเพิ่มครับ"

---

## 💪 Final Reminder
```
คุณเตรียมตัวมาดีแล้ว!
หายใจลึกๆ ยิ้ม แล้วทำให้ดีที่สุด!
```

---

**สู้ๆ นะครับ! 🎯**
