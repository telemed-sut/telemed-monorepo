# Production Readiness Scripts

Scripts for load testing, maintenance, and backup verification.

## Maintenance cleanup

Use the cleanup scripts to enforce retention policies without changing
application behavior.

### Session cleanup (`cleanup_sessions.py`)

Run this script from the backend root to delete revoked or expired session
records after the retention window passes.

```bash
cd backend
venv/bin/python scripts/cleanup_sessions.py
```

The current defaults are:

- revoked sessions retained for 7 days,
- expired sessions retained for 7 days, and
- batch deletion size of 1000 rows.

You can override these values with:

- `SESSION_REVOKED_RETENTION_DAYS`,
- `SESSION_EXPIRED_RETENTION_DAYS`, and
- `SESSION_CLEANUP_BATCH_SIZE`.

## Security sign-off evidence

Use the repository workflow `.github/workflows/security-signoff-evidence.yml`
to capture backend `pip-audit` and frontend `bun audit` results as release
artifacts before production sign-off.

---

## 1. Load Test (`load-test.js`)

Stress test the backend API using [k6](https://k6.io/).

### Install

```bash
# macOS
brew install k6

# Or download: https://k6.io/docs/getting-started/installation/
```

### Run

```bash
cd backend/scripts/

# Smoke test — 5 users, 30 seconds
k6 run load-test.js --vus 5 --duration 30s

# Normal load — 50 users, 2 minutes (default)
BASE_URL=http://localhost:8000 k6 run load-test.js

# Stress test — 200 users, 5 minutes
BASE_URL=http://localhost:8000 k6 run load-test.js --vus 200 --duration 5m

# With authenticated token (tests patient list endpoint)
BASE_URL=http://localhost:8000 AUTH_TOKEN="your-jwt-here" k6 run load-test.js
```

### What it tests

| Endpoint | Purpose | Expected |
|----------|---------|----------|
| `GET /health` | Deep health check | 200 OK, `{"status": "ok"}` |
| `GET /health/live` | Shallow liveness probe | 200 OK |
| `POST /auth/login` | Auth pipeline + rate limiting | 401 (expected for fake creds) |
| `POST /auth/forgot-password` | Email path + rate limiting | 200 or 429 |

### Pass criteria

- **95% of requests < 1,000ms**
- **< 1% error rate** (5xx responses)
- **No crashes** under target concurrency

### Output

Results saved to `load-test-results.json` after each run.

---

## 2. Backup Verification (`verify-backup.sh`)

Verify that a PostgreSQL backup is restorable and contains complete, consistent data.

### Usage

```bash
cd backend/scripts/

# Auto-create backup + verify (reads DATABASE_URL from .env.test / .env.local)
./verify-backup.sh

# Verify an existing backup file
./verify-backup.sh /path/to/backup.sql

# Set DATABASE_URL manually
DATABASE_URL="postgresql://user:pass@localhost:5432/mydb" ./verify-backup.sh
```

### What it checks

| Step | What | Why |
|------|------|-----|
| 1. Create temp DB | Isolated database for testing | No impact on production data |
| 2. Restore backup | `psql -f backup.sql` | Verify backup is valid SQL |
| 3. Schema check | Table count + all key tables exist | No missing tables after restore |
| 4. Row counts | Compare source vs restored for key tables | No data loss |
| 5. Constraints | FK count, unique constraints, indexes | Schema integrity |
| 6. Sequences | Sequence last values match | Auto-increment columns work correctly |
| 7. CASCADE test | Insert + delete test patient | ON DELETE CASCADE configured |
| 8. JSONB data | Audit log entries have valid JSON | Complex data types preserved |
| 9. User integrity | No NULL emails, no duplicates, all have password hashes | Data quality |
| 10. Backup file | File size, CREATE/COPY statements present | Backup file is valid |

### Pass criteria

- **All steps pass** (0 errors)
- **Warnings are acceptable** (e.g., sequence differences, empty tables)

### Output

```
============================================================
  Database Backup Verification
============================================================
  Source DB:      patient_db (localhost:5432)
  Backup file:    /tmp/telemed_backup_20260408.sql (2.4MB)
  Verify DB:      backup_verify_20260408_123456_12345
  Date:           Wed Apr  8 12:00:00 +07 2026
============================================================

  ✅ Table count matches (29 tables)
  ✅ Table 'users' exists
  ...
  ✅ users: 15 rows match
  ✅ All sequences match
  ✅ heart_sound_records has ON DELETE CASCADE
  ...

  Cleanup: dropping temporary database...

  🎉 Backup verification PASSED
     Tests: 42/42 passed
```

---

## 3. CI Integration (Optional)

Add to `.github/workflows/backup-integrity.yml`:

```yaml
name: Backup Integrity Check
on:
  schedule:
    - cron: "0 2 * * 0"  # Weekly on Sunday at 2 AM
  workflow_dispatch:

jobs:
  verify-backup:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15-alpine
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: test_db
        ports: ["5432:5432"]
    steps:
      - uses: actions/checkout@v4
      - name: Run backup verification
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test_db
        run: |
          # First create some data
          psql $DATABASE_URL -c "CREATE TABLE users (id UUID PRIMARY KEY, email TEXT NOT NULL, password_hash TEXT NOT NULL);"
          psql $DATABASE_URL -c "INSERT INTO users VALUES (gen_random_uuid(), 'test@example.com', 'hash');"
          # Then verify
          chmod +x backend/scripts/verify-backup.sh
          ./backend/scripts/verify-backup.sh
```

---

## Schedule Recommendations

| Script | Frequency | When |
|--------|-----------|------|
| **Load test** | Before each major release + monthly | After deploying to staging |
| **Backup verify** | Weekly | Sunday 2 AM (off-peak) |
| **DR drill** | Quarterly | Schedule with team |
