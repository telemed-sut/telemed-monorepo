# Three-role rollout checklist

This document explains how to deploy the completed role consolidation safely.
After this change set, the active system contract supports only `admin`,
`doctor`, and `medical_student`. Legacy role values are removed from runtime
code paths and from the current `user_role` enum migration target.

## What changed

This rollout does three important things:

1. It consolidates runtime access control around `admin`, `doctor`, and
   `medical_student`.
2. It restricts user-facing input contracts so new writes no longer accept
   deprecated role values.
3. It adds an Alembic migration that recreates the PostgreSQL `user_role` enum
   with only the active three roles after normalizing old data.

## Pre-deploy checks

Before you deploy, confirm the following:

- Your target environment uses PostgreSQL and runs Alembic migrations during
  deploy or in a separate pre-deploy step.
- No external system still depends on legacy role strings such as `staff`,
  `nurse`, `pharmacist`, `medical_technologist`, or `psychologist`.
- You have a recent database backup or a snapshot for the target environment.
- The application version that includes the migration deploys together with the
  backend and frontend code that remove legacy compatibility paths.

> **Warning:** Do not deploy the app code without running the new migration.
> The current runtime code no longer recognizes legacy enum values.

## Deploy sequence

Use the following sequence for staging and production.

1. Take a fresh database backup or verify that the latest automated snapshot is
   restorable.
2. Deploy the backend revision that includes the new Alembic migration.
3. Run `alembic upgrade head`.
4. Deploy the frontend revision that matches the three-role model cleanup.
5. Run smoke tests against auth, users, patients, meetings, and invite flows.

## Smoke test checklist

After deploy, verify these flows:

- Log in as `admin`, `doctor`, and `medical_student`.
- Open the **Users** area as `admin` and confirm create, update, invite, and
  restore flows still work.
- Verify that direct user writes reject invalid role values.
- Open assigned patient and meeting views as `medical_student` and confirm the
  experience is read-only.
- Confirm `doctor` can still perform allowed write actions for assigned
  clinical data.
- Confirm `admin` can still access security, audit, and user-management tools.

## Database verification

After `alembic upgrade head` completes, verify the enum contents in PostgreSQL.

```sql
SELECT enumlabel
FROM pg_enum e
JOIN pg_type t ON e.enumtypid = t.oid
WHERE t.typname = 'user_role'
ORDER BY enumsortorder;
```

The result must contain only:

- `admin`
- `doctor`
- `medical_student`

## Rollback note

The new migration includes a downgrade path, but it maps `medical_student`
back to `staff` when recreating the older enum. That makes the downgrade
structurally possible, but it is not a lossless semantic rollback. If you need
to roll back after deploy, restore from backup when role fidelity matters.

## Next steps

After staging passes, reuse the same sequence in production and record the
database verification output in the release notes or deployment log.
