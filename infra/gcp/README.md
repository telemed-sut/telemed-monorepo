# Google Cloud Run Deployment

This folder contains Cloud Run deployment preparation for the telemed monorepo.

## 1) One-time GCP bootstrap

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  vpcaccess.googleapis.com \
  iamcredentials.googleapis.com
```

Create an Artifact Registry repository:

```bash
gcloud artifacts repositories create telemed \
  --repository-format=docker \
  --location=asia-southeast1 \
  --description="Telemed container images"
```

Create required secrets (example names):

```bash
printf '%s' 'postgresql+psycopg://USER:PASSWORD@/DB_NAME?host=/cloudsql/PROJECT:REGION:INSTANCE' | gcloud secrets create DATABASE_URL --data-file=-
printf '%s' 'replace-with-32-char-random-jwt-secret' | gcloud secrets create JWT_SECRET --data-file=-
printf '%s' 'replace-with-32-char-random-device-secret' | gcloud secrets create DEVICE_API_SECRET --data-file=-
```

If secret already exists, add a new version:

```bash
printf '%s' 'new-secret-value' | gcloud secrets versions add JWT_SECRET --data-file=-
```

## 2) Configure GitHub Environment

Workflow files:

- `.github/workflows/deploy-cloud-run.yml`
- `.github/workflows/cloud-run-uptime-check.yml`

Create GitHub Environment (recommended: `staging`, `production`) and set:

- `vars` from `infra/gcp/cloud-run.env.example`
- `secrets`:
  - `GCP_WORKLOAD_IDENTITY_PROVIDER`
  - `GCP_SERVICE_ACCOUNT_EMAIL`
  - `SMOKE_TEST_EMAIL`
  - `SMOKE_TEST_PASSWORD`
  - `SMOKE_TEST_OTP_CODE` (optional if account has 2FA)

`GCP_SERVICE_ACCOUNT_EMAIL` should be a deployer service account that can:

- deploy Cloud Run services
- read Secret Manager secrets
- push to Artifact Registry
- view/update Cloud SQL connection metadata

## 3) Deploy via GitHub Actions

Run workflow manually:

1. GitHub -> Actions -> `Deploy To Google Cloud Run`
2. Select `environment`
3. Set `run_migrations_on_startup=true` only when needed
4. Keep `run_seed_on_startup=false` for cloud
5. Keep `run_smoke_tests=true`

The workflow will:

1. build and push backend image to Artifact Registry
2. deploy backend to Cloud Run
3. build frontend image with backend URL injected at build time
4. deploy frontend to Cloud Run
5. run smoke test (health + login + create patient)

Auto deploy:

- Push to `develop` auto-deploys to `staging` with safe defaults:
  - `RUN_MIGRATIONS_ON_STARTUP=false`
  - `RUN_SEED_ON_STARTUP=false`
  - smoke test enabled

## 4) Uptime Monitoring and Alerts

- Scheduled uptime check every 15 minutes:
  - `.github/workflows/cloud-run-uptime-check.yml`
  - failure summary now includes Cloud Run revision metadata and recent backend
    error logs
- Monitoring guide:
  - `infra/gcp/monitoring-runbook.md`
- Security alert templates:
  - `infra/gcp/alerts/admin-force-password-reset-log-metric.yaml`
  - `infra/gcp/alerts/admin-force-password-reset-alert-policy.yaml`

> **Before deploying alerts:** Replace `REPLACE_BACKEND_SERVICE`, `REPLACE_PROJECT_ID`, and `REPLACE_SECURITY_CHANNEL` in `infra/gcp/alerts/*.yaml` before you run the `gcloud` commands.

## 5) Cloud SQL backup/restore drill

- Script:
  - `infra/gcp/cloud-sql-backup-drill.sh`
- Dry run:

```bash
./infra/gcp/cloud-sql-backup-drill.sh
```

- Execute one drill round:

```bash
./infra/gcp/cloud-sql-backup-drill.sh --execute --cleanup
```

## 6) Release checklist

- `infra/gcp/release-checklist.md`

## 7) Security notes

- Keep `RUN_SEED_ON_STARTUP=false` in cloud environments.
- Restrict `CORS_ORIGINS` to your frontend domain.
- Rotate `JWT_SECRET` and `DEVICE_API_SECRET` via Secret Manager versions.
- Use dedicated service accounts per service (backend/frontend/deployer).
- Treat Alembic migration files as append-only after they have been pushed to a
  shared branch. The CI pipeline blocks non-additive edits to existing
  migration files.
