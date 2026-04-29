# CLAUDE.md — Backend (Patient Management API)

Working directory: `backend/` (the FastAPI service of the `telemed-monorepo`). This file is the senior‑engineer briefing that future Claude sessions should read first.

---

## 1. What this service is

A FastAPI backend for a hospital telemedicine platform. It powers three clients:

- **Web frontend** (`../frontend`) — staff/clinician dashboard.
- **Mobile / patient app** (`../mobile`) — phone+PIN auth, joins video meetings via signed invites.
- **IoT pressure devices** — physical blood‑pressure machines that POST signed payloads to `/device/v1/pressure`.

It owns: auth (JWT + 2FA), users, patients, doctor‑patient assignments, dense‑mode clinical views (timeline, encounters, labs, meds), video meetings (Zego), device ingest, audit logs, IP/account lockout, security admin endpoints, and Novu notifications.

Hard constraint: this is **regulated clinical data**. Most "obvious cleanups" (logging, error messages, audit details) carry compliance/PHI implications. Read the conventions in §6 before touching them.

---

## 2. Stack

- Python 3.11 (Dockerfile pins `3.11.11`); bootstrap script accepts 3.11/3.12/3.13.
- **FastAPI** 0.110, **Pydantic v2** (2.10), **pydantic-settings** 2.5.
- **SQLAlchemy 2.x** (Mapped/select style) + **Alembic** 1.13.
- **PostgreSQL** via `psycopg[binary]` (driver URL is normalized to `postgresql+psycopg://…` in `app/core/config.py`). Production targets Neon/Supabase.
- **JWT** via `python-jose` (HS256). **bcrypt** via `passlib[bcrypt]==1.7.4 / bcrypt==3.2.2` — do not bump independently, the pair is pinned for a reason.
- **slowapi** for rate limiting (memory or Redis backend).
- **Novu** SDK for notifications (optional, gated by `NOVU_ENABLED`).
- **pycryptodomex** for the Zego token signer.
- Tests: `pytest`, `pytest-asyncio` (asyncio_mode=auto), `httpx`, FastAPI `TestClient`.

Pinned in `requirements.txt`. There is no `pyproject.toml`/lockfile — `requirements.txt` is the source of truth.

---

## 3. Layout

```
backend/
├── app/
│   ├── main.py                 # FastAPI app, middleware order, exception handlers
│   ├── core/                   # config, security primitives, limiter, request_utils, search
│   ├── db/                     # Base + SessionLocal (engine bound to settings.database_url)
│   ├── middleware/             # SecurityHeaders, IPBan, SecurityAudit (single __init__.py)
│   ├── models/                 # SQLAlchemy ORM (one file per table; enums in enums.py)
│   ├── schemas/                # Pydantic v2 request/response models
│   ├── services/               # Business logic — RBAC and side‑effects live here
│   └── api/                    # Routers (one per domain)
├── alembic/                    # Migrations (env.py + 27 versions)
├── tests/                      # pytest suite (~24 files)
├── scripts/                    # bootstrap_backend_env.sh, seed.py, run_test_matrix.sh, simulate_device_ingest.py, …
├── Dockerfile, entrypoint.sh   # Two‑stage build; entrypoint waits for DB, runs migrations, optional seed
├── requirements.txt, Makefile, pytest.ini
└── .env.example, .env.test     # Reference only — see §4
```

Routers wired in `app/main.py:12-17, 125-137`: `auth`, `patients`, `meetings`, `users`, `dense_mode`, `alerts`, `audit`, `stats`, `pressure`, `device_monitor`, `security`, `patient_app`, `events`. Health: `GET /health`. Root: `GET /`.

---

## 4. Configuration

**Source of truth is Infisical, not `.env` files.** From the repo root, scripts wrap `infisical run --`:

- `./scripts/dev-api.sh` — uvicorn with reload
- `./scripts/test-backend.sh` — full pytest under Infisical env
- `./scripts/migrate-backend.sh` — `alembic upgrade head`
- `./scripts/seed-backend.sh` — `python -m scripts.seed`
- `./scripts/dev-backend.sh` — docker compose
- Force a specific Infisical env: `INFISICAL_RUN_ARGS="--env=dev" ./scripts/dev-api.sh`

`backend/.env.example` and `.env.test` document the full surface but are **not** loaded automatically in production. For local non‑Infisical work, export vars in your shell or use the `.env.test` file with the test harness.

Settings live in `app/core/config.py` (`Settings(BaseSettings)`, cached via `@lru_cache get_settings()`). Notable validators:

- `database_url` is auto‑rewritten from `postgres://` / `postgresql://` to `postgresql+psycopg://`.
- `DEVICE_API_ALLOW_JWT_SECRET_FALLBACK=true` is **rejected** — old escape hatch, removed for security. Don't try to re‑enable it.
- `DEVICE_API_SECRET` and per‑device entries in `DEVICE_API_SECRETS` must be ≥32 chars and not the obvious weak strings (`changeme`, `default`, `secret`, `change_this_to_a_strong_secret`).
- If `FRONTEND_BASE_URL` is HTTPS, `AUTH_COOKIE_SECURE` must be true (enforced by `model_validator`).
- `MEETING_VIDEO_PROVIDER=zego` requires `ZEGO_APP_ID` and `ZEGO_SERVER_SECRET` (≥16 chars).
- `cors_origins`, `super_admin_emails`, `trusted_proxy_ips`, `rate_limit_whitelist` accept either a JSON list or a comma‑separated string (split by `split_origins`).

Adding a setting? Add it to `Settings`, document it in `.env.example`, and (if a list/dict) add the matching validator.

---

## 5. Database & migrations

- **Connection** via `app/db/session.py` (`engine = create_engine(settings.database_url, pool_pre_ping=True, future=True)`); FastAPI dependency `get_db()` lives in `app/services/auth.py`.
- **Models** are imported from `app/db/base.py` so Alembic autogen sees them. **Add new model imports there** when you create a new table.
- **Alembic config** in `alembic.ini`; `alembic/env.py` reads `settings.database_url` so Infisical/env vars drive migrations transparently.
- Naming convention for new revisions: `YYYYMMDD_NNNN_short_description.py` (see existing files in `alembic/versions/`). The Alembic `script.py.mako` template doesn't auto‑apply this name — set the filename manually after `alembic revision -m "…"`.
- Migrations on container start are gated by `RUN_MIGRATIONS_ON_STARTUP` (default true); seed by `RUN_SEED_ON_STARTUP` (default true). Disable for shared envs.

Soft delete is the default for **users** and **patients** (`deleted_at`, `deleted_by`, `restored_at`, `restored_by`). Hard delete only via the admin "purge" flow with `confirm_text="PURGE"` (`POST /users/purge-deleted`). Do not introduce `db.delete(user)` in normal flows.

---

## 6. Security model — read before touching auth/audit/device code

Several non‑obvious invariants are enforced across this codebase. They look removable; they're not.

### 6.1 RBAC layers
Roles (`app/models/enums.py:UserRole`): `admin`, `staff`, `doctor`, `nurse`, `pharmacist`, `medical_technologist`, `psychologist`. Helpers in `app/services/auth.py`: `get_admin_user`, `get_doctor_user`, `get_clinical_user`, `get_doctor_or_nurse_user`, `verify_patient_access*`, plus `is_super_admin()` (matches `SUPER_ADMIN_EMAILS`).

Phase‑1 patient‑access policy: **admin = full**, **doctor = only assigned patients** (via `DoctorPatientAssignment`), **everyone else = forbidden**. Enforced in `app/services/patient.py:verify_doctor_patient_access`. Break‑glass is disabled (`enable_break_glass_access=False`); the helper in `auth.py:_has_active_break_glass` is dormant — don't activate it without a policy decision.

Service‑layer enforcement is intentional: routers call `verify_doctor_patient_access` so that helper functions, background tasks, and tests all share the same gate. Don't move the check up into the router and skip the service call.

### 6.2 JWT + cookies + CSRF
- Tokens are HS256, payload `{sub, role, exp}`, default TTL `JWT_EXPIRES_IN=3600`. Issued by `app/services/auth.py:create_login_response`.
- Auth is accepted via Bearer header **or** the `access_token` cookie (httponly, secure controlled by `AUTH_COOKIE_SECURE`).
- When auth comes from the cookie, `_validate_cookie_csrf` enforces an `Origin`/`Referer` allowlist built from `FRONTEND_BASE_URL` + `CORS_ORIGINS` for state‑changing methods. Non‑browser clients (no Origin/Referer) are allowed. Don't remove this — it's the only CSRF defense for cookie auth.

### 6.3 2FA / TOTP / backup codes / trusted devices
- Admin 2FA is required by default (`ADMIN_2FA_REQUIRED=true`). Enabling/disabling and resets all write `AuditLog` rows; preserve those entries when refactoring.
- TOTP is implemented inline in `app/core/security.py` (no `pyotp` dep). Backup codes are 10‑char base32 strings (`generate_backup_code`). Codes are stored as SHA‑256 hashes (`UserBackupCode.code_hash`).
- Trusted devices: cookie `trusted_device_token`, hash stored server‑side, optional UA‑hash binding (`hash_user_agent`). Days configurable per role (`ADMIN_TRUSTED_DEVICE_DAYS=7`, `USER_TRUSTED_DEVICE_DAYS=30`).
- Login flow that handles 2FA challenge, trusted‑device cookie, backup‑code use, lockout, and audit is in `app/api/auth.py:546-736`. Read it end‑to‑end before changing any branch.

### 6.4 Account lockout & IP ban
- Per‑user: `MAX_LOGIN_ATTEMPTS=10` / `ACCOUNT_LOCKOUT_MINUTES=15` (admin: 15 / 3). Locked account → HTTP **423** (not 401/403). Logic in `app/services/security.py:handle_failed_login` and `check_account_locked`.
- Per‑IP: `IP_BAN_THRESHOLD=20` failed attempts in `IP_ATTEMPT_WINDOW_MINUTES=15` triggers `IPBan` for `IP_BAN_DURATION_MINUTES=30`. Enforced very early by `IPBanMiddleware` (`app/middleware/__init__.py`) with a 30 s in‑process cache to keep the DB hit low.
- Whitelists: `SECURITY_WHITELISTED_IPS` (general bypass), `RATE_LIMIT_WHITELIST` (skip slowapi).
- Minimum admin floor: `MIN_ACTIVE_ADMIN_ACCOUNTS=2`. Updates/deletes that would drop active admins below this fail with 400. Code paths in `app/api/users.py:update_user`, `delete_user`, `bulk_delete_users` all use `_active_admin_count_for_update` with `with_for_update()` — preserve the row lock.

### 6.5 Device API HMAC contract (`/device/v1/pressure`, `/add_pressure` legacy)
Per‑request headers: `X-Device-Id`, `X-Timestamp`, `X-Signature`. Optional but recommended in production: `X-Body-Hash`, `X-Nonce`. The signature is HMAC‑SHA256 over `timestamp + device_id [+ body_hash] [+ nonce]` with the device secret resolved from (in order):

1. `device_registrations` table (admin‑managed, can be deactivated)
2. `DEVICE_API_SECRETS` JSON map
3. `DEVICE_API_SECRET` global fallback (only if `DEVICE_API_REQUIRE_REGISTERED_DEVICE=false`)

Constraints enforced in `app/api/pressure.py:verify_device_signature`:
- 5‑minute timestamp window (`MAX_TIMESTAMP_DIFF=300`).
- Body size cap (`DEVICE_API_MAX_BODY_BYTES`, default 256 KiB).
- `device_id` in payload must match the header.
- Body‑hash verified via `hmac.compare_digest`; nonces stored in `device_request_nonces` with TTL and unique constraint (replay → IntegrityError → "replay_nonce" error).
- All errors collapse to a generic `403 "Invalid signature"` response and a structured `DeviceErrorLog` row. **Do not surface the specific reason in the HTTP response** — leaking it gives an attacker an oracle. The internal reason string after `AUTH_FAILED:` is what the device monitor consumes.

### 6.6 Audit logging conventions
- Every state‑changing privileged endpoint writes an `AuditLog` row through `app.services.audit.log_action` or inline `db.add(AuditLog(...))`. Do **not** silently drop these.
- `SecurityAuditMiddleware` writes a `http_403_denied` row for every 403 (skipping `/health`, `/`, `/docs*`, `/openapi*`). When you add a new path that legitimately returns 403 noise (e.g. health probes), add it to that allowlist instead of suppressing the audit log elsewhere.
- **Never put PHI in `details`.** Patterns to follow:
  - `app/api/patients.py:_mask_people_id` — show only `***NNNN`.
  - `app/api/users.py:_user_snapshot` and `_mask_license_no` — masked snapshots only.
  - For updates, log the list of *changed field names*, not the values.
- `details` is a JSONB column (`AuditLog.details`); it accepts dicts directly. Legacy rows may be raw JSON strings — defensive parsing exists in `app/api/users.py:_restore_email_from_audit`. Mirror that pattern when reading audit details.

### 6.7 Rate limiting
- `slowapi` keyed by (in priority order): whitelist bypass → hashed `Bearer` token → `X-Device-Id` → IP. Implementation in `app/core/limiter.py`.
- Login uses two limits: `60/minute` general (per user/IP) and `10/minute` for failed attempts (per‑IP via `get_failed_login_key`). The 429 handler also writes a `LoginAttempt` row so brute‑force noise is captured.
- During tests `app.state.limiter.enabled = False` (`tests/conftest.py:25`). When you write a new test that exercises rate limiting, re‑enable it explicitly inside the test.

### 6.8 Trusted proxy / client‑IP extraction
Use `app.core.request_utils.get_client_ip(request)` everywhere. It only honours `CF-Connecting-IP` / `X-Forwarded-For` when `request.client.host` is in `TRUSTED_PROXY_IPS`. Reading those headers directly is a footgun that breaks rate‑limiting and IP bans.

---

## 7. Common workflows

### Run locally without Docker
```bash
# from backend/
./scripts/bootstrap_backend_env.sh        # creates ./venv, syncs requirements.txt, runs `pip check`
source venv/bin/activate
infisical run -- alembic upgrade head
infisical run -- python -m scripts.seed   # demo users + ~15 fake patients (idempotent)
infisical run -- uvicorn app.main:app --reload
```

### Run with Docker
`./scripts/dev-backend.sh` from repo root. The entrypoint waits for the DB, runs migrations, optionally seeds, then `uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips $TRUSTED_PROXY_IPS`.

### Tests
```bash
python -m pytest                                  # full suite, SQLite in‑memory
./scripts/run_test_matrix.sh compat               # full suite with permissive device security
./scripts/run_test_matrix.sh strict               # device hardening smoke test (registered device + body hash + nonce)
./scripts/run_test_matrix.sh all                  # both
TEST_DATABASE_URL=postgresql+psycopg://... \
  ../scripts/test-backend-postgres-subset.sh      # PG‑sensitive subset (users/patients/audit/2FA/security/stats)
make backend-test-env                             # bootstrap venv before running tests on a fresh machine
```

`tests/conftest.py` is doing real work; understand it before debugging fixtures:
- It sets `DEVICE_API_SECRET`, `ADMIN_2FA_REQUIRED=false`, and the strict‑mode toggles to `false` before importing the app.
- It overrides `get_db` with `TestingSessionLocal`, defaults to `sqlite:///:memory:` with `StaticPool`, and registers SQLite compilers for `UUID`/`JSONB`/`ARRAY` so PG‑typed columns load.
- Per‑test it `create_all` / `drop_all` on SQLite, but `TRUNCATE … RESTART IDENTITY CASCADE` on Postgres — and `RUN_TEST_MIGRATIONS=true` makes it run Alembic before tests.

The custom marker `meeting_presence_regression` is registered in `pytest.ini` for the meeting status reconciliation cases.

### Migrations
```bash
infisical run -- alembic revision -m "describe change" --autogenerate
# rename file to YYYYMMDD_NNNN_describe_change.py and edit `down_revision`
infisical run -- alembic upgrade head
infisical run -- alembic downgrade -1   # only ever in dev/test
```

### Hitting the device endpoint by hand
- Bruno: see `BRUNO_README.md` (it ships a working pre‑request HMAC script).
- Python simulator: `python -m scripts.simulate_device_ingest …` — supports `--alternate-error`, `--error-rate`, and `--legacy-signature`.

---

## 8. Conventions to follow

- **Layered responsibilities.** Routers parse/validate and translate to HTTP errors. Services own RBAC and DB writes. Models are dumb. Don't call SQLAlchemy directly from routers (the existing `app/api/users.py` and `app/api/audit.py` are the closest exceptions and even those funnel through helpers).
- **Use `select()` 2.x style**, not legacy `db.query()`. New code must use `select(...)` with `db.scalars()` / `db.execute()`. (Some service code still uses `db.query` for compatibility — fine to leave, don't add more.)
- **All UTC, all the time.** `datetime.now(timezone.utc)`. Never `utcnow()` (deprecated; the only use of `utcnow` in `app/core/security.py:_JoseDatetimeCompat` is a shim for `python-jose`). Naive datetimes coming back from the DB get normalized in‑place.
- **Pydantic v2:** `model_dump(exclude_unset=True)`, `model_copy(update=...)`, `field_validator`, `model_validator`. No `.dict()`, no `Config` classes — use `model_config = {...}`.
- **Error responses:** `HTTPException(status_code=…, detail=…)`. Don't invent a new error envelope. The login flow returns a structured `detail` dict for the 2FA challenge — keep that shape if you extend the auth flow.
- **Background tasks:** use FastAPI's `BackgroundTasks` (see `app/api/patients.py:notify_staff`). Lazy‑import `app.services.novu` inside the function — Novu must remain truly optional (`NOVU_ENABLED=false` should be a no‑op).
- **Soft delete:** filter by `deleted_at.is_(None)` and `is_active == True` in every list/get path. The `_retired_email(user_id)` helper (`deleted+<hex>@archive.example.com`) is how soft‑deleted accounts free up an email. Don't reuse the original email on delete — it leaks PHI.
- **Don't widen audit `details`.** Add fields deliberately, mask anything that's PHI, and keep entries small (they're stored forever for compliance).
- **Phase‑1 invite policy:** clinical roles (`CLINICAL_ROLES` in `app/schemas/user.py`) must be onboarded via `/users/invites` → `/auth/invite/accept`, never `/users` direct create. `SPECIALIST_INVITE_ONLY=true` enforces this in the API.

---

## 9. Gotchas

- **Two pressure endpoints, one handler.** `/add_pressure` is a deprecated alias of `/device/v1/pressure` and just calls into `create_pressure_record`. Don't fork the implementation — fix bugs in the new endpoint.
- **`DEVICE_API_SECRET` validation aborts startup.** If the value is too weak, the app fails to boot with a Pydantic `ValueError`. In CI/test set the long sentinel from `.env.test`; in production rotate via Infisical, not in‑process.
- **CORS + frontend port.** `CORS_ORIGINS` defaults to `http://localhost:3000,http://localhost:8080`. Frontend on port 3001 will silently fail preflight — extend the var.
- **Vercel deploy.** `vercel.json` points to `app/main.py`. Vercel doesn't run `entrypoint.sh`, so migrations and seeds don't auto‑run there. If a Vercel preview is broken, that's almost certainly why.
- **Bcrypt pin.** `bcrypt==3.2.2` is paired with `passlib==1.7.4`. Newer bcrypt emits warnings and changes the version detection; passlib breaks. Bump them together if you must.
- **`pytest -k` with the asyncio default mode.** Tests are `asyncio_mode=auto`; sync `def test_*` work fine, but mixing event loops in one test file occasionally interacts badly with `TestClient`. Prefer the existing fixture (`client` from `conftest.py`) over instantiating `TestClient(app)` ad‑hoc.
- **Debug helpers.** `debug_data.py`, `debug_db.py`, `debug_endpoint.py`, `simple_test.py`, and `unban_user.py` at the repo root are ad‑hoc scripts. They're not part of the production surface — don't import from them.
- **Vercel/Cloud Run health check.** `Dockerfile` HEALTHCHECK hits `http://127.0.0.1:8000/health` every 30 s. The `/health` endpoint uses `@limiter.limit("200/minute")` — keep it cheap (no DB call) so the limiter isn't the bottleneck under stress.

---

## 10. Where to look first when…

- "Why was this 403'd?" → check `audit_logs` for `http_403_denied` and the matching `_log_patient_access_denied` row.
- "Login is acting weird." → `app/api/auth.py:login` first, then `app/services/security.py` for lockout/IP‑ban math.
- "Device ingest is rejecting my payload." → grep `device_error_logs.error_message` for the `AUTH_FAILED:<reason>` string; the user‑facing 403 is intentionally generic.
- "What does the patient mobile flow look like?" → `app/api/patient_app.py` (registration code, login by phone+PIN, meeting invite exchange) and `app/services/patient_app.py`.
- "How is the meeting state computed?" → `app/services/meeting_presence.py` (presence reconciliation) + `app/services/meeting_video.py` (Zego token, patient invites, short codes). Status enum: `app/models/enums.py:MeetingStatus`.
- "How are tests structured?" → `tests/test_pressure_security.py` for the device contract, `tests/test_users.py` for the most thorough RBAC/soft‑delete coverage, `tests/test_meeting_video_token.py` for the Zego flow. The `docs/backend-testing-blueprint.md` is the long‑form rationale.

---

## 11. Out‑of‑scope reminders

- This service does **not** own frontend code (`../frontend`) or mobile code (`../mobile`).
- Production secrets live in Infisical. Don't paste them into `.env` files or commit them. `.gitleaks.toml` and `trivy.yaml` exist at the repo root; respect them.
- Reports/screenshots in the repo root (`Report_Telemed_TH.docx`, `report_screenshots/`, `security_best_practices_report.md`) are deliverables — don't edit them as part of normal feature work.
