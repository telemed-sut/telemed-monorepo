# Production security readiness checklist

Use this checklist before you declare the system production-ready. It is
written for operator-run verification, not for local development.

This checklist assumes the current codebase already includes:

- server-side session enforcement for staff, admin, and patient app auth,
- trusted-device cleanup on logout,
- recent-MFA gates for security-sensitive account actions, and
- tightened defaults for closed-system deployments,
- patient PIN lockout with server-side counters, and
- patient app refresh, logout-all, and device-context enforcement for newly
  issued tokens.

## Required environment and secrets

Confirm the runtime environment is configured before you start functional
checks.

- Set `APP_ENV=production`.
- Set `JWT_SECRET` to a unique value with at least 32 characters.
- Set `MEETING_SIGNING_SECRET` to a dedicated value with at least 32
  characters.
- Set `DEVICE_SECRET_ENCRYPTION_KEY` and `TWO_FACTOR_SECRET_ENCRYPTION_KEY` to
  valid 32-byte base64 keys.
- Set `ALLOW_INSECURE_SECRET_STORAGE=false`.
- Set `AUTH_COOKIE_SECURE=true`.
- Set explicit `ALLOWED_HOSTS` and `CORS_ORIGINS` for the deployed origins.
- Set `REDIS_URL`; production rate limiting must not fall back to memory.
- Set `API_DOCS_ENABLED=false` unless there is an approved exception.

## Session and auth policy

Confirm the deployed policy matches the intended closed-system posture.

- `ADMIN_JWT_EXPIRES_IN=14400`, unless an approved policy exception exists.
- `PRIVILEGED_ACTION_MFA_MAX_AGE_SECONDS=900`, unless an approved policy
  exception exists.
- `ADMIN_TRUSTED_DEVICE_DAYS=1`, unless an approved policy exception exists.
- `USER_TRUSTED_DEVICE_DAYS=7`, unless an approved policy exception exists.
- `ADMIN_2FA_REQUIRED=true`.
- `PATIENT_PIN_MAX_LOGIN_ATTEMPTS=5`, unless an approved policy exception
  exists.
- `PATIENT_PIN_LOCKOUT_MINUTES=15`, unless an approved policy exception exists.
- `PATIENT_APP_TOKEN_TTL_SECONDS=604800`, unless an approved policy exception
  exists.
- Pre-hardening patient sessions are invalidated during rollout, or you have
  explicit evidence that patient tokens without `device_ctx` are rejected.

## Runtime behavior

Run these checks in the deployed environment.

1. Sign in as an admin and confirm the dashboard loads.
2. Refresh the page and confirm the session stays active.
3. Sign out and confirm the next request returns to the login screen.
4. Trigger a sensitive action after more than 15 minutes and confirm the app
   requests fresh MFA.
5. Enter the wrong patient PIN five times and confirm the account locks for the
   configured interval.
6. If the environment still has pre-hardening patient tokens, confirm those
   tokens now return `401` and force a fresh login. If there are no remaining
   legacy sessions, record the invalidation mechanism you used during rollout.
7. Sign in to the patient app, then call the patient refresh flow.
8. Confirm the older patient token no longer works after refresh.
9. Confirm the refreshed patient token works only from the original device
   context.
10. Attempt patient logout from a different device context and confirm the API
    rejects it.
11. Sign in to the patient app from another device or session.
12. Confirm the older patient token no longer works.
13. Trigger patient logout-all and confirm every active patient session is
    revoked.

Record the result of each step in
[production-verification-log-template.md](./production-verification-log-template.md).

## Session cleanup and logging

Confirm the maintenance and observability paths are in place.

- Schedule `backend/scripts/cleanup_sessions.py` in the same cron path that
  already runs audit or login-attempt cleanup.
- Confirm structured logging is enabled in production.
- Confirm request IDs are present in application responses and logs.
- Confirm sensitive fields remain redacted in production log sinks.
- Confirm startup logs include the Alembic preflight line with both database
  revisions and repo heads.
- Confirm the release artifact or build step consumes `backend/requirements.lock`
  or an equivalent hash-pinned backend dependency artifact.
- Confirm Sentry, or the approved monitoring equivalent, is configured if used
  by your release policy.
- Confirm your deploy pipeline includes:
  - an Alembic single-head check,
  - an env contract check,
  - a migration immutability check, and
  - a post-migration schema smoke check.

## Closed-system sign-off

Use this section for the final operational sign-off.

- Shared workstation policy is documented for staff and admins.
- Admin re-auth expectations are communicated to the team.
- Trusted-device retention is documented for support staff.
- Emergency access and recovery flows are documented and tested.
- Dependency audit output from a network-enabled environment is archived.
- Final operator sign-off names the environment, date, and reviewer.

Use
[infra-ops-security-review-template.md](./infra-ops-security-review-template.md)
for the infrastructure and operations review, then capture the final release
decision in
[security-sign-off-note-template.md](./security-sign-off-note-template.md).

## Next steps

If any item fails, stop the rollout and compare the deployed environment with
[backend/.env.example](../../backend/.env.example),
[infra/staging/.env.example](../../infra/staging/.env.example), and
[admin-session-validation-checklist.md](./admin-session-validation-checklist.md)
before changing application code.
