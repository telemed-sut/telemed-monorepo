# Release Checklist (Cloud Run)

## Before Deploy

1. CI green on target commit (`CI Gates`, `CodeQL`, `Performance Smoke`)
2. Alembic migration reviewed and rollback path documented
3. GitHub Environment vars/secrets updated (no plaintext secrets in repo)
4. Secret Manager latest versions verified (`DATABASE_URL`, `JWT_SECRET`, `DEVICE_API_SECRET`)
5. `RUN_SEED_ON_STARTUP=false` for cloud env
6. `SUPER_ADMIN_EMAILS` reviewed for bootstrap or break-glass scope only
7. `PRIVILEGED_ACTION_MFA_MAX_AGE_SECONDS` matches security policy

## Deploy

1. Trigger `.github/workflows/deploy-cloud-run.yml`
2. Select environment (`staging` or `production`)
3. For first rollout with schema change: `run_migrations_on_startup=true`
4. Keep `run_seed_on_startup=false`
5. Keep `run_smoke_tests=true`

## Post Deploy Verification

1. Backend `/health` = 200
2. Frontend root page loads
3. Smoke test passed (login + create patient)
4. Cloud Run logs show no error spike
5. p95 latency and 5xx alert dashboards are normal
6. Privileged operator can complete `/auth/me` and one recovery action with recent MFA

## Rollback (if needed)

1. Roll back Cloud Run backend/frontend to previous healthy revision
2. If migration caused issue, execute DB rollback plan
3. Re-run smoke test on rolled-back revision
4. Open incident note and capture root cause/actions
