## Patient Management API (FastAPI)

FastAPI backend with JWT auth, PostgreSQL (Neon/Supabase), patient CRUD,
Alembic migrations, and local-only demo seed data. Default CORS origins are
http://localhost:3000 and http://localhost:8080, backend runs on port 8000.

### Stack
- FastAPI, Pydantic v2
- SQLAlchemy 2.x, Alembic
- PostgreSQL (via psycopg)
- JWT (PyJWT), bcrypt

### Project layout
- [app/main.py](app/main.py) – FastAPI app and routers
- [app/api](app/api) – auth and patients routes
- [app/services](app/services) – auth/patient business logic
- [app/models](app/models) – SQLAlchemy models
- [app/schemas](app/schemas) – Pydantic schemas
- [app/core](app/core) – settings and security helpers
- [alembic](alembic) – migrations (env + versions)
- [scripts/seed.py](scripts/seed.py) – local demo data (users + patients)
- [backend/Dockerfile](backend/Dockerfile), [docker-compose.yml](docker-compose.yml)

### Environment variables
- DATABASE_URL: Postgres connection URL (Neon/Supabase)
- JWT_SECRET: HMAC secret for HS256 tokens
- JWT_EXPIRES_IN: token lifetime in seconds (e.g., 3600)
- ADMIN_JWT_EXPIRES_IN: admin session lifetime in seconds (default 43200)
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
`.env.example` documents required keys only. `backend/.env` is not an official runtime source anymore.

### Frontend Integration
- Backend URL: `http://localhost:8000`
- Frontend Env: `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`
- Allowed Origins: Frontend must run on port **3000** or **8080** (e.g. `http://localhost:3000`).
  - Note: Other ports (like 3001) will fail CORS checks unless added to runtime config / Infisical secrets.

### Backend environment bootstrap
Use the bootstrap script to create or refresh the backend virtual environment
before you run tests or start the API. It installs `requirements.txt`, checks
package integrity, and verifies that the local pytest plugins and lint tooling
are present.

From `backend/`:

```bash
./scripts/bootstrap_backend_env.sh
```

If you prefer `make`, run:

```bash
make backend-test-env
```

### Dependency locking
Use the lock workflow when you need a reproducible backend environment with
hash verification. `requirements.txt` remains the human-maintained top-level
input, and `requirements.lock` captures the fully resolved, hash-pinned set.

From `backend/`:

```bash
make deps-lock
make deps-sync
```

`./scripts/bootstrap_backend_env.sh` now prefers `requirements.lock` when the
file exists. Set `REQUIREMENTS_FILE=/path/to/file` if you need to override the
source explicitly.

Optional environment overrides:
- `PYTHON_BIN=/path/to/python3.12` picks a specific interpreter.
- `VENV_DIR=/custom/path/to/venv` installs into a different virtual environment.
- `UPGRADE_PIP=1` upgrades `pip` before syncing dependencies.
- `REQUIREMENTS_FILE=/path/to/requirements.txt` overrides the dependency source.

### Running locally (without Docker)
1) Bootstrap the environment with `./scripts/bootstrap_backend_env.sh`.
2) Activate the virtual environment: `source venv/bin/activate`.
3) Load env vars via Infisical (`infisical run -- ...`) or by exporting env vars
   in your shell.
4) Run migrations: `alembic upgrade head`.
5) Optional: seed local demo data: `python -m scripts.seed`.
6) Start API: `infisical run -- uvicorn app.main:app --reload` (defaults to
   8000).

From the repo root you can use the Infisical-aware wrappers instead:

```bash
./scripts/dev-api.sh
./scripts/test-backend.sh
./scripts/migrate-backend.sh
./scripts/seed-backend.sh
```

If you want to force a specific Infisical environment:

```bash
INFISICAL_RUN_ARGS="--env=dev" ./scripts/dev-api.sh
```

### Running with Docker Compose
1) Preferred: run the team script from repo root (`./scripts/dev-backend.sh`).
   If you want to check the exact runtime config first, run
   `just doctor-backend-env` from the repo root.
2) Alternative: export the required env vars in your shell, create a local
   `docker-compose.override.yml`, then run `docker compose up --build`.
3) Backend runs on port 8000; local Docker Compose can run migrations and demo
   seed before uvicorn starts.
4) Keep tracked `docker-compose.yml` production-safe. For local hot reload, add
   the backend bind mount in `docker-compose.override.yml`:

```yaml
services:
  backend:
    volumes:
      - ./backend:/app
```

5) If you need to debug PostgreSQL from the host, add the port mapping only in
   your local override and remove it after use:

```yaml
services:
  db:
    ports:
      - "5432:5432"
```

The backend runtime preflight now catches the local issues that most often
cause startup loops:
- missing `DATABASE_URL`, `JWT_SECRET`, or device ingest secrets
- placeholder values like `replace_with_*`
- insecure default `DATABASE_URL` credentials like `user:password@`
- short JWT or device secrets that backend validation would reject later

### Auth and local demo users
- Login endpoint: POST /auth/login with {"email", "password"}.
- Refresh endpoint: POST /auth/refresh (requires valid JWT token).
- Logout endpoint: POST /auth/logout (stateless JWT - client should discard token).
- Non-admin accounts use `JWT_EXPIRES_IN` for the rolling cookie session.
- Admin accounts use `ADMIN_JWT_EXPIRES_IN` for the rolling cookie session.
- Admin secure verification window for routine protected actions uses
  `PRIVILEGED_ACTION_MFA_MAX_AGE_SECONDS` (default 4 hours).
- Higher-risk admin recovery and privileged-management actions require a fresher
  MFA check than the general secure window.
- Local seed creates bootstrap accounts for:
  - `admin@example.com` (platform admin demo account)
  - `admin-ops@example.com` (regular admin demo account)
  - `doctor@example.com`
  - `medical-student@example.com`
- For deterministic local passwords, export these env vars before seeding:
  - `SEED_ADMIN_PASSWORD`
  - `SEED_REGULAR_ADMIN_PASSWORD`
  - `SEED_DOCTOR_PASSWORD`
  - `SEED_MEDICAL_STUDENT_PASSWORD`
- The seed script refuses to run against non-local database targets unless you
  set `ALLOW_DEMO_SEED=true` explicitly.
- `SUPER_ADMIN_EMAILS` is bootstrap and break-glass fallback only. Production
  privileged access is assigned in the database.
- When admin SSO is enabled, the backend uses PKCE and stores OIDC login/logout
  artifacts server-side. Configure `REDIS_URL` for multi-instance environments
  and `ADMIN_OIDC_CACHE_TTL_SECONDS` to tune OIDC metadata/JWKS caching.

JWT payload: sub (user id), role, exp. Token type bearer.

### Role-based Access Control (Phase-1)
- **Admin users**: Full access to patient operations and assignment management.
- **Doctor users**: Access only assigned patients (own + explicitly assigned).
- **Medical student users**: Read-only access to assigned patient data.
- **Break-glass**: disabled by policy in phase-1.

### Admin operations and recovery
- Admin onboarding uses invite flow in production-oriented paths.
- Only `super-admin` users can issue `admin` invites or perform emergency
  security actions on other admin accounts.
- Emergency unlock is available through the security toolkit and
  [scripts/emergency_unlock_admin.py](scripts/emergency_unlock_admin.py).
- Operational docs:
  - [docs/security/admin-access-policy.md](/Volumes/P1Back/telemed-monorepo/docs/security/admin-access-policy.md)
  - [docs/security/admin-emergency-access-runbook.md](/Volumes/P1Back/telemed-monorepo/docs/security/admin-emergency-access-runbook.md)
  - [docs/security/secret-rotation-runbook.md](/Volumes/P1Back/telemed-monorepo/docs/security/secret-rotation-runbook.md)

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
- Unit tests: `python -m pytest`
- API tests: Import `Patient_Management_API.postman_collection.json` into Postman
- Test coverage includes auth, patients CRUD, role-based access, and error handling
- Test matrix profiles:
  - compat profile (full suite): `./scripts/run_test_matrix.sh compat`
  - strict profile (device security smoke test): `./scripts/run_test_matrix.sh strict`
  - both profiles: `./scripts/run_test_matrix.sh all`
- PostgreSQL subset profile from repo root: `TEST_DATABASE_URL=postgresql+psycopg://... ./scripts/test-backend-postgres-subset.sh`
  - Runs the most DB-sensitive suites with `RUN_TEST_MIGRATIONS=true` by default.
  - Current subset: `test_users`, `test_patients`, `test_dense_mode_access`, `test_audit_logs`, `test_auth_2fa_management`, `test_security_admin_endpoints`, `test_stats_and_audit_contracts`
- Bootstrap test env first when setting up a fresh machine: `make backend-test-env`

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
`python -m scripts.seed` inserts local demo users and around 15 realistic
patients if tables are empty. The script is blocked for non-local database
targets unless you opt in with `ALLOW_DEMO_SEED=true`.

### Notes
- CORS allows only configured origins and Authorization header.
- Compatibility enum values still exist for older data, but the active access model is `admin`, `doctor`, and `medical_student`.
