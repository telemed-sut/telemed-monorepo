## Patient Management API (FastAPI)

FastAPI backend with JWT auth, PostgreSQL (Neon/Supabase), patient CRUD, Alembic migrations, and seed data. Default CORS origins are http://localhost:3000 and http://localhost:8080, backend runs on port 8000.

### Stack
- FastAPI, Pydantic v2
- SQLAlchemy 2.x, Alembic
- PostgreSQL (via psycopg)
- JWT (python-jose), passlib[bcrypt]

### Project layout
- [app/main.py](app/main.py) – FastAPI app and routers
- [app/api](app/api) – auth and patients routes
- [app/services](app/services) – auth/patient business logic
- [app/models](app/models) – SQLAlchemy models
- [app/schemas](app/schemas) – Pydantic schemas
- [app/core](app/core) – settings and security helpers
- [alembic](alembic) – migrations (env + versions)
- [scripts/seed.py](scripts/seed.py) – demo data (users + patients)
- [backend/Dockerfile](backend/Dockerfile), [docker-compose.yml](docker-compose.yml)

### Environment variables
- DATABASE_URL: Postgres connection URL (Neon/Supabase)
- JWT_SECRET: HMAC secret for HS256 tokens
- JWT_EXPIRES_IN: token lifetime in seconds (e.g., 3600)
- CORS_ORIGINS: comma-separated origins (default http://localhost:3000,http://localhost:8080)
- DEVICE_API_SECRET: fallback secret for device pressure ingestion signatures (keep for legacy migration)
- DEVICE_API_SECRETS: per-device secret map (JSON string), recommended for production
- DEVICE_API_ALLOW_JWT_SECRET_FALLBACK: allow fallback to JWT secret when device secret is missing (default true for backward compatibility)
- DEVICE_API_REQUIRE_REGISTERED_DEVICE: reject device IDs not found in DEVICE_API_SECRETS
- DEVICE_API_REQUIRE_BODY_HASH_SIGNATURE: require `X-Body-Hash` and signature over body hash (recommended true in production)
- DEVICE_API_REQUIRE_NONCE: require `X-Nonce` and nonce-bound signature to prevent replay
- DEVICE_API_NONCE_TTL_SECONDS: nonce replay window retention
- DEVICE_API_MAX_BODY_BYTES: max accepted request payload size in bytes

See [.env.example](.env.example) for a starter file.

### Frontend Integration
- Backend URL: `http://localhost:8000`
- Frontend Env: `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`
- Allowed Origins: Frontend must run on port **3000** or **8080** (e.g. `http://localhost:3000`).
  - Note: Other ports (like 3001) will fail CORS checks unless added to `.env`.

### Running locally (without Docker)
1) Create and activate a Python 3.11+ venv.
2) Install dependencies: `pip install -r requirements.txt`.
3) Set env vars (DATABASE_URL, JWT_SECRET, JWT_EXPIRES_IN, CORS_ORIGINS).
4) Run migrations: `alembic upgrade head`.
5) Seed demo data: `python -m scripts.seed`.
6) Start API: `uvicorn app.main:app --reload` (defaults to 8000).

### Running with Docker Compose
1) Copy .env.example to .env and fill values (use sslmode=require for Supabase URLs).
2) `docker-compose up --build` (backend on port 8000). Migrations and seed run automatically before uvicorn starts.

### Auth and demo users
- Login endpoint: POST /auth/login with {"email", "password"}.
- Refresh endpoint: POST /auth/refresh (requires valid JWT token).
- Logout endpoint: POST /auth/logout (stateless JWT - client should discard token).
- Demo credentials:
	- admin@example.com / AdminPass123
	- staff@example.com / StaffPass123

JWT payload: sub (user id), role, exp. Token type bearer.

### Role-based Access Control (Phase-1)
- **Admin users**: Full access to patient operations and assignment management.
- **Doctor users**: Access only assigned patients (own + explicitly assigned).
- **Staff users**: No patient clinical access.
- **Break-glass**: disabled by policy in phase-1.

### Patients API
- POST /patients (create) - Admin/Doctor
- GET /patients?page=1&limit=20&q=term&sort=created_at&order=desc - Admin/Doctor
  - Doctor results are assignment-filtered.
  - Search q matches first_name, last_name, email, phone (ILIKE).
  - Sort: created_at|updated_at|last_name|first_name; order asc|desc.
- GET /patients/{id} - Admin/Doctor (doctor must be assigned)
- PUT /patients/{id} - Admin/Doctor (doctor must be assigned)
- DELETE /patients/{id} (hard delete) - **Admin only**

Pagination response: {items, page, limit, total}. Validation -> 422; missing -> 404; auth -> 401; forbidden -> 403 with detail.

### Testing
- Unit tests: `pytest` (requires test dependencies)
- API tests: Import `Patient_Management_API.postman_collection.json` into Postman
- Test coverage includes auth, patients CRUD, role-based access, and error handling

### Seeds
`python -m scripts.seed` inserts demo users and ~15 realistic patients if tables are empty. In Docker Compose this runs automatically after alembic upgrade.

### Notes
- CORS allows only configured origins and Authorization header.
- Role enum scaffold (admin|staff) present; all authenticated users can use CRUD by default.
