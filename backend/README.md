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

Primary source should be Infisical secrets at runtime.  
Fallback local file: copy [.env.example](.env.example) to `.env`.

### Frontend Integration
- Backend URL: `http://localhost:8000`
- Frontend Env: `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`
- Allowed Origins: Frontend must run on port **3000** or **8080** (e.g. `http://localhost:3000`).
  - Note: Other ports (like 3001) will fail CORS checks unless added to `.env`.

### Running locally (without Docker)
1) Create and activate a Python 3.11+ venv.
2) Install dependencies: `pip install -r requirements.txt`.
3) Load env vars via Infisical (`infisical run -- ...`) or fallback `.env`.
4) Run migrations: `alembic upgrade head`.
5) Seed demo data: `python -m scripts.seed`.
6) Start API: `infisical run -- uvicorn app.main:app --reload` (defaults to 8000).

### Running with Docker Compose
1) Preferred: run Compose through Infisical from repo root (`./scripts/compose-up-infisical.sh`).
2) Fallback: copy `.env.example` to `.env` and run `docker compose up --build`.
3) Backend runs on port 8000; migrations and seed run automatically before uvicorn starts.

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

### Device Pressure API Contract
- Primary endpoint: `POST /device/v1/pressure`
- Legacy endpoint: `POST /add_pressure` (deprecated alias, same behavior)

Required request headers:
- `X-Device-Id`
- `X-Timestamp` (unix seconds)
- `X-Signature`
- `X-Body-Hash` (required only when `DEVICE_API_REQUIRE_BODY_HASH_SIGNATURE=true`)
- `X-Nonce` (required only when `DEVICE_API_REQUIRE_NONCE=true`)

Request body:
```json
{
  "user_id": "721e584f-f3f9-4beb-81b0-bfc688e487ce",
  "device_id": "test_device_001",
  "heart_rate": 80,
  "sys_rate": 120,
  "dia_rate": 70,
  "a": [100, 110, 120, 110, 100],
  "b": [80, 85, 90, 85, 80],
  "measured_at": "2026-02-20T12:00:00Z"
}
```

Response body (`201 Created`):
```json
{
  "id": "ecf958f4-ef8c-4e0d-b2f3-6f2f1a92c3b0",
  "received_at": "2026-02-20T12:00:02.312Z",
  "patient_id": "721e584f-f3f9-4beb-81b0-bfc688e487ce"
}
```

Validation highlights:
- `user_id` must be UUID.
- `sys_rate` must be greater than `dia_rate`.
- `a` and `b` must be equal length when both provided.

### Testing
- Unit tests: `python -m pytest` (requires test dependencies)
- API tests: Import `Patient_Management_API.postman_collection.json` into Postman
- Test coverage includes auth, patients CRUD, role-based access, and error handling
- Test matrix profiles:
  - compat profile (full suite): `./scripts/run_test_matrix.sh compat`
  - strict profile (device security smoke test): `./scripts/run_test_matrix.sh strict`
  - both profiles: `./scripts/run_test_matrix.sh all`

### Real device style simulation (HTTP ingest)
Use this when you want to simulate an actual machine sending signed payloads to `/device/v1/pressure`.

From `backend/`:

```bash
source venv/bin/activate
python -m scripts.simulate_device_ingest \
  --base-url http://localhost:8000 \
  --endpoint /device/v1/pressure \
  --patient-id 721e584f-f3f9-4beb-81b0-bfc688e487ce \
  --device-id test_device_NEW_006 \
  --secret-key "<device_secret_from_DEVICE_API_SECRETS>" \
  --interval 1 \
  --count 30
```

Notes:
- Default mode is strict production signing (`timestamp + device_id + body_hash + nonce`).
- `--count 0` means run forever.
- Use `--legacy-signature` only for legacy mode environments.

Alternate success/error testing (recommended for monitor and runbook verification):

```bash
python -m scripts.simulate_device_ingest \
  --base-url http://localhost:8000 \
  --endpoint /device/v1/pressure \
  --patient-id 721e584f-f3f9-4beb-81b0-bfc688e487ce \
  --device-id test_device_NEW_006 \
  --secret-key "<device_secret_from_DEVICE_API_SECRETS>" \
  --alternate-error \
  --error-scenarios invalid_body_hash,missing_nonce,timestamp_out_of_window,validation_failed,unknown_patient \
  --interval 1 \
  --count 20
```

- `--alternate-error`: sends `success, error, success, error, ...`
- `--error-rate 0.2`: random error injection (20%) instead of alternating

### Seeds
`python -m scripts.seed` inserts demo users and ~15 realistic patients if tables are empty. In Docker Compose this runs automatically after alembic upgrade.

### Notes
- CORS allows only configured origins and Authorization header.
- Role enum scaffold (admin|staff) present; all authenticated users can use CRUD by default.
