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
- Demo credentials:
	- admin@example.com / AdminPass123
	- staff@example.com / StaffPass123

JWT payload: sub (user id), role, exp. Token type bearer.

### Patients API
- POST /patients (create)
- GET /patients?page=1&limit=20&q=term&sort=created_at&order=desc
	- Search q matches first_name, last_name, email, phone (ILIKE)
	- Sort: created_at|updated_at|last_name; order asc|desc
- GET /patients/{id}
- PUT /patients/{id}
- DELETE /patients/{id} (hard delete)

Pagination response: {items, page, limit, total}. Validation -> 422; missing -> 404; auth -> 401 with detail.

### Seeds
`python -m scripts.seed` inserts demo users and ~15 realistic patients if tables are empty. In Docker Compose this runs automatically after alembic upgrade.

### Notes
- CORS allows only configured origins and Authorization header.
- Role enum scaffold (admin|staff) present; all authenticated users can use CRUD by default.
