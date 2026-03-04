# Telemed Platform Monorepo

This repository is the main codebase for a real telemedicine platform used by doctors and internal teams.
All work in this repository should be treated as production-impacting.

## What This System Supports

- Daily clinical workflow for patient management and follow-up
- Role-based operations for medical and non-medical users
- Security-first access control and auditability
- Device data ingestion from external medical hardware
- Team-based development with CI quality gates

## Core Capabilities

### Clinical and Operational Workflow

- Patient management with pagination, search, sorting, and role-based controls
- Patient assignment model (admin-managed doctor assignment)
- Meeting and queue management for consultations
- Dense mode clinical view:
  - patient summary
  - timeline
  - active orders
  - lab trends
  - note/order creation
- Alerts workflow with acknowledgment controls

### Identity, Security, and Governance

- JWT authentication with refresh/logout endpoints
- HTTP-only auth cookie support
- 2FA support with trusted devices and backup codes
- Granular role-based access control (RBAC)
- Security operations toolkit:
  - emergency admin unlock (policy-guarded)
  - login-attempt monitoring
  - IP ban management
  - security metrics
- Full audit logging with filters and CSV export
- API rate limiting

### Device Integration

- HMAC-signed ingestion endpoint for blood pressure devices
- Device health/stats/error endpoints
- Device error logging for troubleshooting and reliability

## User Roles in the System

Roles currently supported in the backend:

- `admin`
- `staff`
- `doctor`
- `nurse`
- `pharmacist`
- `medical_technologist`
- `psychologist`

Clinical-role onboarding is enforced through invite flow policies where configured.

## Tech Stack

### Frontend

- Next.js 16 (App Router)
- React 19
- TypeScript
- Tailwind CSS
- Zustand
- Radix-based components and custom dashboard UI
- Vitest + Testing Library

### Backend

- FastAPI
- SQLAlchemy 2.x
- Alembic
- Pydantic v2
- python-jose (JWT), bcrypt/passlib
- slowapi (rate limiting)

### Data and Infra

- PostgreSQL 15
- Docker and Docker Compose
- GitHub Actions CI (`.github/workflows/backend-tests.yml`)
- Google Cloud Run deployment workflow (`.github/workflows/deploy-cloud-run.yml`)
- Cloud Run uptime monitor workflow (`.github/workflows/cloud-run-uptime-check.yml`)

## High-Level Architecture

```text
Users (Web)
   |
   v
Next.js Frontend (:3000)
   |
   v
FastAPI Backend (:8000) <------ Device Clients (HMAC)
   |                                  |
   v                                  v
PostgreSQL (:5432)              /device/v1/* endpoints
```

## Repository Structure

```text
telemed-monorepo/
├── frontend/                     # Next.js web application
├── backend/                      # FastAPI service + migrations + tests
├── mobile/patient_flutter_app/   # Flutter patient app starter (ZEGO)
├── Telemed Device API/           # Bruno collection for device API testing
├── scripts/                      # Utility scripts
├── docker-compose.yml            # Local full-stack orchestration
├── RELEASE_NOTES_ADMIN_USERS_V2.md
└── README.md
```

## Quick Start (Docker, Recommended)

```bash
docker compose up --build
```

Services:

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- Swagger docs: http://localhost:8000/docs

Notes:

- Backend container runs migrations and seed step on startup via `backend/entrypoint.sh`.
- Compose includes a local PostgreSQL service.

## Local Development (Without Docker)

### 1) Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
alembic upgrade head
python -m scripts.seed
uvicorn app.main:app --reload
```

### 2) Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

### 3) Patient Mobile (Flutter)

```bash
./scripts/bootstrap-patient-flutter.sh
cd mobile/patient_flutter_app
flutter run \
  --dart-define=ZEGO_APP_ID=<APP_ID> \
  --dart-define=ZEGO_APP_SIGN=<APP_SIGN> \
  --dart-define=TELEMED_API_BASE_URL=http://<YOUR_LAN_IP>:8000
```

Windows (Android) shortcut:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\bootstrap-patient-flutter.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\windows\run-patient-flutter.ps1
```

## Required Environment Variables

### Backend (`backend/.env`)

Minimum required:

- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`

Important for production hardening:

- `DEVICE_API_SECRET`
- `CORS_ORIGINS`
- `FRONTEND_BASE_URL`
- `AUTH_COOKIE_SECURE`
- `ADMIN_2FA_REQUIRED`
- `SUPER_ADMIN_EMAILS`

Reference file: `backend/.env.example`

### Frontend (`frontend/.env.local`)

- `NEXT_PUBLIC_API_BASE_URL` (default local value is `http://localhost:8000`)

Reference file: `frontend/.env.example`

## API Surface (Summary)

Main route groups:

- `/auth` - login, token refresh, logout, password reset, 2FA, invite acceptance
- `/users` - user lifecycle management, invite lifecycle, verification, restore/purge
- `/patients` - patient CRUD, assignments, dense mode clinical endpoints
- `/meetings` - consultation scheduling and lifecycle
- `/alerts` - alert acknowledgment
- `/stats` - dashboard overview metrics
- `/audit` - audit log search and export
- `/security` - security administration endpoints
- `/device/v1/*` - device health, stats, errors, pressure ingestion

For full schemas and request/response models, use Swagger:

- http://localhost:8000/docs

## Team Development Workflow

1. Create a feature branch from your working branch.
2. Keep changes scoped and include migration files for schema changes.
3. Run local checks before opening PR:
   - backend: `cd backend && python -m pytest`
   - frontend: `npx tsc --noEmit && npm run lint && npm run test`
4. Open PR and request review.
5. Merge only after CI passes.

CI workflow currently validates backend and frontend quality gates on `main` and `develop`.

## Local Bootstrap Accounts (Development Only)

`python -m scripts.seed` creates local bootstrap users:

- `admin@example.com` / `AdminPass123`
- `staff@example.com` / `StaffPass123`

These credentials are for local development only and must never be used in production.

## Additional Documentation

- Backend details: `backend/README.md`
- Frontend details: `frontend/README.md`
- Cloud Run deployment guide: `infra/gcp/README.md`
- Monitoring runbook: `infra/gcp/monitoring-runbook.md`
- Release checklist: `infra/gcp/release-checklist.md`
- Admin security release notes: `RELEASE_NOTES_ADMIN_USERS_V2.md`

## Operational Notice

Because this platform supports real clinical operations, all changes should be treated as production-impacting:

- protect secrets and PHI/PII
- keep auditability intact
- preserve backward compatibility for active workflows
- validate access controls and role permissions before release
