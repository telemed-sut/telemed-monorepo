# สรุประบบและเทคโนโลยีที่ใช้

เอกสารนี้สรุปภาพรวมว่าในระบบ telemedicine นี้ใช้เทคโนโลยีอะไรบ้าง
และมีองค์ประกอบหลักอะไรที่นำมาสร้างระบบ เพื่อใช้เป็นเอกสารสั้นสำหรับเก็บใน repo

## ภาพรวมระบบ

ระบบนี้เป็น monorepo สำหรับงาน telemedicine โดยมี 3 ส่วนหลักคือ

- Frontend สำหรับหน้าระบบที่ผู้ใช้เข้าใช้งาน
- Backend สำหรับ API และ business logic
- Database สำหรับเก็บข้อมูลหลักของระบบ

นอกจากนี้ยังมีส่วนเสริมที่เกี่ยวข้องกับการใช้งานจริง เช่น video call,
patient mobile app, notification และ device integration

## เทคโนโลยีฝั่ง Frontend

ฝั่ง frontend ใช้สำหรับ dashboard, หน้าผู้ป่วย, หน้านัดหมาย, และหน้าสำหรับ
เข้าร่วมการคอลของผู้ป่วย

| หมวด | เทคโนโลยี |
| --- | --- |
| Framework | Next.js 16 |
| UI Runtime | React 19 |
| Language | TypeScript |
| Styling | Tailwind CSS 4 |
| Package Manager | Bun |
| State Management | Zustand |
| UI Libraries | Radix UI, Base UI |
| Table/Data UI | TanStack Table |
| Charts | Recharts |
| Motion | Framer Motion |
| Internationalization | `next-intl` |

## เทคโนโลยีฝั่ง Backend

backend ใช้สำหรับจัดการ API, authentication, authorization, patient data,
meeting flow, audit log, security และ integration ต่าง ๆ

| หมวด | เทคโนโลยี |
| --- | --- |
| Framework | FastAPI |
| Language | Python 3.11 |
| ORM | SQLAlchemy 2.x |
| Migration | Alembic |
| Validation / Settings | Pydantic v2, pydantic-settings |
| DB Driver | Psycopg 3 |
| Auth | JWT, `python-jose`, `passlib`, `bcrypt` |
| Rate Limiting | `slowapi` |
| API Server | Uvicorn |

## ฐานข้อมูล

ระบบใช้ฐานข้อมูลเชิงสัมพันธ์เป็นหลัก

| หมวด | เทคโนโลยี |
| --- | --- |
| Primary Database | PostgreSQL 15 |
| Local DB Container | `postgres:15-alpine` |
| Data Access | SQLAlchemy |
| Schema Migration | Alembic |

## เครื่องมือและระบบประกอบ

นอกจาก frontend, backend และ database แล้ว ระบบนี้ยังใช้เครื่องมือและ service
เพิ่มเติมดังนี้

| ส่วนประกอบ | เทคโนโลยี / เครื่องมือ | หน้าที่ |
| --- | --- | --- |
| Video Call | ZEGO UIKit | ใช้สำหรับการคอลระหว่างแพทย์และผู้ป่วย |
| Notification | Novu | รองรับ notification flow |
| Patient Mobile App | Flutter | แอปฝั่งผู้ป่วย |
| Device Integration | Device API endpoints | รับข้อมูลจากอุปกรณ์ |
| API Test Assets | Bruno collection | ใช้ทดสอบ device API |

## ระบบด้านความปลอดภัย

ระบบมีองค์ประกอบด้าน security ที่สำคัญดังนี้

- JWT authentication
- HTTP-only auth cookie support
- 2FA
- trusted devices
- role-based access control
- rate limiting
- audit logging
- security middleware
- device secret validation

## การพัฒนาและการ deploy

| หมวด | เทคโนโลยี / เครื่องมือ |
| --- | --- |
| Local Development | Docker Compose |
| Frontend Container | Bun build + Node runtime |
| Backend Container | Python multi-stage Docker build |
| CI/CD | GitHub Actions |
| Cloud Deployment Workflow | Google Cloud Run |
| Registry Publishing | GHCR, Artifact Registry |
| Hosting Config in Repo | Vercel config |

## การทดสอบและคุณภาพ

| ส่วน | เครื่องมือ |
| --- | --- |
| Frontend Testing | Vitest, Testing Library |
| Backend Testing | Pytest, pytest-asyncio, pytest-cov |
| Lint / Type Check | ESLint, TypeScript, Ruff |
| Security Scan | Gitleaks, TruffleHog, CodeQL |
| Performance Check | Lighthouse CI, k6 |

## สรุป

ระบบนี้ถูกพัฒนาด้วย stack หลักคือ:

- Frontend: Next.js + React + TypeScript
- Backend: FastAPI + SQLAlchemy + Alembic
- Database: PostgreSQL

และมี integration สำคัญเพิ่มเติมคือ ZEGO, Novu, Flutter mobile app,
device API, Docker, GitHub Actions และ Cloud Run workflow
