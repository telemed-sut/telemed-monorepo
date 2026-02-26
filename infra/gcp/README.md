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

Workflow file: `.github/workflows/deploy-cloud-run.yml`

Create GitHub Environment (recommended: `staging`, `production`) and set:

- `vars` from `infra/gcp/cloud-run.env.example`
- `secrets`:
  - `GCP_WORKLOAD_IDENTITY_PROVIDER`
  - `GCP_SERVICE_ACCOUNT_EMAIL`

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

The workflow will:

1. build and push backend image to Artifact Registry
2. deploy backend to Cloud Run
3. build frontend image with backend URL injected at build time
4. deploy frontend to Cloud Run

## 4) Security notes

- Keep `RUN_SEED_ON_STARTUP=false` in cloud environments.
- Restrict `CORS_ORIGINS` to your frontend domain.
- Rotate `JWT_SECRET` and `DEVICE_API_SECRET` via Secret Manager versions.
- Use dedicated service accounts per service (backend/frontend/deployer).
