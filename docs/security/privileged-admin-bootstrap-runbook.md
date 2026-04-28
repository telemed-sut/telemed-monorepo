# Privileged admin bootstrap runbook

This runbook explains how you bootstrap privileged admin access in a new
environment and how you remove bootstrap-only controls after the system is
live. Use it together with
[admin access policy](/Volumes/P1Back/telemed-monorepo/docs/security/admin-access-policy.md)
and
[admin emergency access runbook](/Volumes/P1Back/telemed-monorepo/docs/security/admin-emergency-access-runbook.md).

## Overview

Telemed Platform now treats privileged admin access as DB-backed role
assignments. `SUPER_ADMIN_EMAILS` remains only as a bootstrap and break-glass
fallback. Your goal is to use that fallback briefly, assign the real roles in
the database, verify recovery paths, and then keep the env allowlist as small
as possible.

## Before you begin

Complete this checklist before the first production bootstrap:

1. Confirm the target environment uses `RUN_SEED_ON_STARTUP=false`.
2. Confirm the target environment has `AUTH_COOKIE_SECURE=true`.
3. Confirm the target environment has a strong `JWT_SECRET` loaded from
   Infisical.
4. Confirm the first operator has a named `admin` account in the database.
5. Confirm the operator can complete MFA and has a ticket or approval reference.

## Bootstrap the first privileged operator

Use this sequence for the first production-grade setup.

1. Create the operator as a normal `admin` account through invite flow.
2. Add that operator's email to `SUPER_ADMIN_EMAILS` in Infisical.
3. Deploy or restart the backend so the runtime picks up the new value and runs the startup backfill.
4. Confirm the backend created a DB-backed `platform_super_admin` assignment for that user.
5. Sign in as that operator and complete MFA.
6. Create any additional DB-backed privileged role assignments through
   `POST /security/privileged-role-assignments`.

Use the following assignments as your default starting point:

- Assign `platform_super_admin` to one or two named platform operators.
- Assign `security_admin` to the operators who can run account recovery.
- Assign `hospital_admin` only to users who manage local hospital operations.

## Verify the privileged model

After bootstrap, verify the system works without relying on env-only access.

1. Call `GET /auth/me` and confirm `privileged_roles` is populated.
2. Confirm the bootstrap admin was backfilled as `platform_super_admin`.
3. Verify the operator can create an admin invite with a reason.
4. Verify the operator can perform a recovery action only after recent MFA.
5. Verify a plain `admin` without privileged assignments is denied.
6. Verify audit logs capture the actor, target, action, and reason.

## Reduce bootstrap-only access

After at least one DB-backed privileged operator is verified, shrink the
bootstrap surface.

1. Remove any unnecessary emails from `SUPER_ADMIN_EMAILS`.
2. Keep only the approved bootstrap or break-glass entries.
3. Record who approved the reduced list.
4. Re-deploy the backend.
5. Re-test `GET /auth/me` and one privileged action.

## Break-glass expectations

Treat `SUPER_ADMIN_EMAILS` as emergency-only after bootstrap. Do not use it as
the day-to-day source of truth for privileged access.

If you must keep a break-glass email in the env allowlist:

- make it a named organizational account or a tightly governed operator record,
- protect it with MFA and an approved password manager,
- alert on every use, and
- review the access at least quarterly.

## Hospital deployment checklist

Review these controls before each production rollout:

1. `AUTH_COOKIE_SECURE=true` and `AUTH_COOKIE_SAMESITE` is explicitly set.
2. `PRIVILEGED_ACTION_MFA_MAX_AGE_SECONDS` matches policy.
3. `SUPER_ADMIN_EMAILS` contains only approved bootstrap or break-glass entries.
4. Docs exposure is reviewed, including `/docs` and `/openapi.json`.
5. Immutable audit export or SIEM forwarding is enabled outside the app.
6. Secret rotation ownership is documented.
7. Trusted proxies and allowed origins match the real network path.

## Next steps

After you complete bootstrap, keep the other security runbooks aligned with the
deployed environment:

- [Admin access policy](/Volumes/P1Back/telemed-monorepo/docs/security/admin-access-policy.md)
- [Admin emergency access runbook](/Volumes/P1Back/telemed-monorepo/docs/security/admin-emergency-access-runbook.md)
- [Secret rotation runbook](/Volumes/P1Back/telemed-monorepo/docs/security/secret-rotation-runbook.md)
