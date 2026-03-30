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
- `doctor`
- `medical_student`

Clinical-role onboarding is enforced through invite flow policies where configured.

## Operational runbooks

Production admin operations now have repo-backed policy and runbook documents:

- [Admin access policy](/Volumes/P1Back/telemed-monorepo/docs/security/admin-access-policy.md)
- [Admin emergency access runbook](/Volumes/P1Back/telemed-monorepo/docs/security/admin-emergency-access-runbook.md)
- [Admin SSO (authentik) runbook](/Volumes/P1Back/telemed-monorepo/docs/security/admin-sso-authentik-runbook.md)
- [Secret rotation runbook](/Volumes/P1Back/telemed-monorepo/docs/security/secret-rotation-runbook.md)

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

## Quick Start (Docker + Infisical, Primary)

Primary backend command:

```bash
./scripts/dev-backend.sh
```

Primary frontend command:

```bash
./scripts/dev-frontend.sh
```

Primary share-link command:

```bash
./scripts/dev-share-link.sh
```

Optional (if your Infisical CLI needs explicit runtime args):

```bash
INFISICAL_RUN_ARGS="--projectId <project_id> --env <environment> --path /" ./scripts/dev-backend.sh
```

The same pattern works with every Infisical-aware helper under `scripts/`, for example:

```bash
INFISICAL_RUN_ARGS="--env=dev" ./scripts/dev-frontend.sh
INFISICAL_RUN_ARGS="--env=dev" ./scripts/test-backend.sh
INFISICAL_RUN_ARGS="--env=dev" ./scripts/build-frontend.sh
```

## Just command runner

You can use `just` as a lightweight command runner at the repository root.
It wraps the existing project scripts, so it improves command discoverability
without changing the current backend, frontend, or Infisical workflows.

Install `just` with your platform package manager. For example, on macOS:

```bash
brew install just
```

Then run common tasks from the repository root:

```bash
just help
just doctor
just dev
just dev-backend
just dev-frontend
just ci
just ci-fast
just test-backend
just test-frontend
just build-frontend
just migrate-backend
just seed-backend
just check
```

`just doctor` checks whether your local machine has the required CLI tools and
local dependency directories. `just ci` runs the main local backend and
frontend quality gates that most closely match the core checks in GitHub
Actions. `just ci-fast` runs a quicker static-check pass, and `just dev`
starts the backend in the background, waits for `http://localhost:8000/health`
to respond, and then runs the frontend in the foreground.

Common local commands:

```bash
./scripts/dev-backend.sh      # Docker Compose: db + backend
./scripts/dev-frontend.sh     # Next.js dev server
./scripts/dev-api.sh          # FastAPI directly from backend/venv
./scripts/test-backend.sh     # pytest -q with Infisical env
./scripts/migrate-backend.sh  # alembic upgrade head
./scripts/seed-backend.sh     # python -m scripts.seed
./scripts/test-frontend.sh    # vitest run
./scripts/build-frontend.sh   # next build
TEST_DATABASE_URL=postgresql+psycopg://user:password@localhost:5432/patient_db ./scripts/test-backend-postgres-subset.sh
```

Services:

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- Swagger docs: http://localhost:8000/docs

Notes:

- Official scripts ignore root `.env`; the source of truth is Infisical runtime env.
- Backend container runs migrations on startup and can run the local demo seed
  step via `backend/entrypoint.sh`.
- To bring up local admin SSO with Authentik, start the identity profile:

```bash
COMPOSE_PROFILES=identity ./scripts/dev-backend.sh
```

- Local admin SSO expects the redirect URI
  `http://localhost:3000/api/auth/admin/sso/callback` and uses the frontend
  proxy so the browser keeps the session cookie on the frontend origin.
- Compose includes a local PostgreSQL service.
- The backend CI workflow in [.github/workflows/backend-tests.yml](/Volumes/P1Back/telemed-monorepo/.github/workflows/backend-tests.yml) already runs the main backend suite against PostgreSQL.

## Local Development (Without Docker)

### 1) Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
python -m scripts.seed
infisical run -- uvicorn app.main:app --reload
```

Fallback only:

```bash
export DATABASE_URL=...
export JWT_SECRET=...
uvicorn app.main:app --reload
```

### 2) Frontend

```bash
cd frontend
bun install
bun run dev
```

Local config:

```bash
cp .env.example .env.local
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

Primary secret source: Infisical project/environment.

Reference files:

- Root `.env.example`: optional compose/env reference only
- Backend `backend/.env.example`: required backend keys reference
- Frontend `frontend/.env.local` (from `frontend/.env.example`): local frontend convenience config

### Backend (Infisical)

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
- `SUPER_ADMIN_EMAILS` for bootstrap and break-glass fallback only
- `PRIVILEGED_ACTION_MFA_MAX_AGE_SECONDS`

Reference file: `backend/.env.example`

### Frontend (Local Dev)

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

`python -m scripts.seed` creates local bootstrap users for:

- `admin@example.com`
- `doctor@example.com`
- `medical-student@example.com`

The seed script is intended for local development only. It refuses to run
against non-local database targets unless you set `ALLOW_DEMO_SEED=true`
explicitly. If you want deterministic local passwords, export
`SEED_ADMIN_PASSWORD`, `SEED_DOCTOR_PASSWORD`, and
`SEED_MEDICAL_STUDENT_PASSWORD` before seeding.

Production authorization no longer uses seeded users or
`SUPER_ADMIN_EMAILS` as the daily source of truth. Day-to-day privileged admin
access is DB-backed and must be assigned explicitly.

## Additional Documentation

- Backend details: `backend/README.md`
- Three-role rollout: `docs/three-role-rollout-checklist.md`
- Privileged admin bootstrap: `docs/security/privileged-admin-bootstrap-runbook.md`
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
