# 🎯 Pre-Interview Guide: กลยุทธ์ก่อนสัมภาษณ์

> ⏱️ ใช้เวลาอ่าน: 1 ชั่วโมง

---

## 📅 Timeline ก่อนวันสัมภาษณ์

### D-1 (วันก่อน)
- [ ] อ่าน README_TH.md (30 นาที)
- [ ] อ่าน interview_prep.md ทั้งหมด (1-2 ชม.)
- [ ] ซ้อม demo ครั้งที่ 1
- [ ] นอนหลับให้พอ (อย่างน้อย 7 ชม.)

### D-Day (วันสัมภาษณ์)
- [ ] ตื่นเช้า เตรียมตัว
- [ ] อ่าน quick_cheatsheet.md (15 นาที)
- [ ] เช็คว่า `docker compose up --build` ทำงานได้
- [ ] เปิด VS Code เตรียมไฟล์สำคัญ

---

## 🖥️ เตรียม Environment

### เปิดไว้รอ:
```bash
# Terminal 1: รัน Docker
cd /path/to/project
docker compose up --build

# Terminal 2: สำรอง (ถ้า Docker มีปัญหา)
cd backend && source venv/bin/activate
```

### Browser Tabs:
1. http://localhost:3000 (Frontend)
2. http://localhost:8000/docs (Swagger API Docs)
3. GitHub repo ของคุณ

### VS Code เปิดไฟล์:
1. `docker-compose.yml`
2. `backend/app/main.py`
3. `backend/app/api/patients.py`
4. `backend/app/core/security.py`

---

## 🎬 Demo Script (ซ้อม 2-3 รอบ)

### Step 1: แนะนำโปรเจค (1-2 นาที)
> "ผม/หนูทำ Patient Management System ครับ/ค่ะ 
> เป็น full-stack app ใช้ Next.js + FastAPI + PostgreSQL
> รองรับ JWT authentication และ CRUD operations
> Deploy ได้ด้วย Docker Compose แค่คำสั่งเดียว"

### Step 2: รัน Demo (2-3 นาที)
```bash
docker compose up --build
```
> "ใช้ docker compose up แล้ว build 3 containers:
> - PostgreSQL database
> - FastAPI backend  
> - Next.js frontend"

### Step 3: แสดง Login (2 นาที)
1. ไปที่ http://localhost:3000
2. Login ด้วย admin@example.com / AdminPass123
> "ระบบใช้ JWT authentication 
> Password ถูก hash ด้วย bcrypt
> Token หมดอายุใน 1 ชั่วโมง"

### Step 4: แสดง Patient CRUD (3-5 นาที)
1. ดูรายการผู้ป่วย
2. Search ชื่อ
3. สร้างผู้ป่วยใหม่
4. แก้ไขข้อมูล
5. ลบ (Admin only)

> "มี pagination, search, sort ครบ
> Staff ลบไม่ได้ ต้องเป็น Admin เท่านั้น
> ข้อมูลมี validation ทั้ง frontend และ backend"

### Step 5: แสดง API Docs (1-2 นาที)
1. ไปที่ http://localhost:8000/docs
> "FastAPI generate Swagger docs ให้อัตโนมัติ
> ทดสอบ API ได้เลยจากหน้านี้"

### Step 6: แสดง Code (ถ้าถูกขอ)
- เปิด `main.py` → CORS, Rate limiting
- เปิด `security.py` → JWT, Password hashing
- เปิด `patients.py` → CRUD endpoints

---

## 🗣️ วิธีตอบคำถาม

### ✅ Good Response Pattern:
1. **ตอบตรงๆ สั้นๆ** ก่อน
2. **ให้เหตุผล** ว่าทำไม
3. **ยกตัวอย่าง** ถ้ามี

**ตัวอย่าง:**
> Q: "ทำไมใช้ FastAPI?"
> 
> A: "ผมเลือก FastAPI เพราะ 3 เหตุผลครับ
> 1. เร็วมาก รองรับ async
> 2. มี Swagger docs อัตโนมัติ ช่วยให้ทดสอบได้ง่าย
> 3. ใช้ Pydantic validate request ได้สะดวก"

### ❌ หลีกเลี่ยง:
- ตอบว่า "ไม่รู้" แล้วหยุด → ใช้ "ไม่แน่ใจครับ แต่คิดว่า..." แทน
- พูดยาวเกินไป → สรุปใน 30 วินาที
- โกหก → ถ้าไม่รู้ ก็บอกตรงๆ ว่าจะไปศึกษาเพิ่ม

---

## 😰 ถ้าเจอปัญหา

### Docker ไม่ทำงาน:
```bash
# ลอง reset
docker compose down -v
docker compose up --build

# ถ้ายังไม่ได้ ใช้ local dev
cd backend && uvicorn app.main:app --reload
cd frontend && npm run dev
```

### ลืมคำตอบ:
> "ขอโทษครับ ลืมไปชั่วครู่ ขออนุญาตเปิดดูโค้ดเลยนะครับ"
> (เปิด VS Code ดูไฟล์ที่เกี่ยวข้อง)

### ไม่เข้าใจคำถาม:
> "ขอโทษครับ ช่วยอธิบายเพิ่มเติมได้ไหมครับ?"

### ตอบไม่ได้:
> "ตรงนี้ผม/หนูยังไม่ค่อยแม่นครับ/ค่ะ 
> แต่จะไปศึกษาเพิ่มเติมหลังจากนี้ครับ/ค่ะ"

---

## 🎭 Body Language

- 👀 **สบตา** เป็นระยะ
- 🙂 **ยิ้ม** เป็นธรรมชาติ
- 🪑 **นั่งตรง** ไม่เอียง
- 🤲 **มือ** วางบนโต๊ะ ไม่กอดอก
- 🎤 **พูดชัด** ไม่เร็วเกินไป

---

## 💭 Mindset

### ก่อนสัมภาษณ์:
> "ผม/หนูเตรียมตัวมาดีแล้ว 
> ถึงไม่รู้ทุกอย่าง แต่พร้อมเรียนรู้
> นี่คือโอกาสแสดงความสามารถ"

### ระหว่างสัมภาษณ์:
> "ผม/หนูกำลังพูดคุยกับคนที่อาจเป็นเพื่อนร่วมงาน
> ไม่ใช่การสอบ แต่เป็นการแลกเปลี่ยน"

### ถ้าเจอคำถามยาก:
> "คำถามดีมากครับ ขอคิดสักครู่...
> (หายใจลึก คิด 5 วิ แล้วตอบ)"

---

## ❓ คำถามที่ควรถามพี่ (ตอนท้าย)

1. "ทีมใช้ tech stack อะไรบ้างครับ?"
2. "น้องฝึกงานจะได้ทำ project แบบไหนครับ?"
3. "มี code review process ยังไงครับ?"
4. "อะไรที่พี่อยากเห็นจากน้องฝึกงานมากที่สุดครับ?"

---

## ✅ Checklist ก่อนสัมภาษณ์

- [ ] ซ้อม demo 2-3 รอบ ✓
- [ ] ทดสอบ docker compose up ✓
- [ ] เตรียม VS Code ✓
- [ ] อ่าน quick_cheatsheet.md ✓
- [ ] หายใจลึกๆ ผ่อนคลาย ✓

---

**พร้อมแล้ว! ไปอ่าน `quick_cheatsheet.md` สุดท้ายก่อนสัมภาษณ์ 🚀**
