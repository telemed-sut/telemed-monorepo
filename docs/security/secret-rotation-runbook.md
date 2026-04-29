# Secret rotation runbook

This runbook describes how to rotate production secrets for Telemed Platform
without improvising during an incident. It covers the runtime secrets already
used by this repository and clarifies which values are operational secrets
versus user-held credentials.

Use this runbook after suspected exposure, role transitions, or a scheduled
hardening review.

## What counts as a secret here

The following values are runtime secrets and belong in Infisical or another
system secret store:

- `DATABASE_URL`
- `JWT_SECRET`
- `DEVICE_API_SECRET`
- `DEVICE_API_SECRETS`
- `NOVU_API_KEY`
- `ZEGO_SERVER_SECRET`

The following values are not user passwords, but still require controlled
change management because they affect bootstrap or break-glass behavior:

- `SUPER_ADMIN_EMAILS`
- `TRUSTED_PROXY_IPS`

Do not use this runbook for personal admin passwords. Those belong in the
password manager process defined in
[admin access policy](/Volumes/P1Back/telemed-monorepo/docs/security/admin-access-policy.md).

## When you must rotate

Rotate immediately when any of these conditions is true:

- a secret appears in a terminal log, ticket, or chat,
- a team member with shared secret access leaves the project,
- a CI or deployment credential is exposed,
- a device secret is copied to an uncontrolled system,
- a signing key may have been exfiltrated from a workstation, or
- you cannot prove the current secret remained private.

## Prepare the rotation

Before you change any value, complete this checklist:

1. Identify which environments are affected.
2. Create or confirm a rollback plan.
3. Verify who has authority to update Infisical and deploy the services.
4. Record the incident or maintenance ticket.
5. Confirm you have access to staging for validation before production if time
   permits.

## Rotation sequence

Use this sequence unless the incident demands a faster direct cutover.

### Rotate `JWT_SECRET`

This is the highest-impact application secret because it invalidates sessions.

1. Generate a new random secret with at least 32 characters.
2. Update `JWT_SECRET` in Infisical for the target environment.
3. Deploy the backend with the new value.
4. Verify login, refresh, logout, and protected admin routes.
5. Announce that existing sessions will require reauthentication.

Because the current backend uses a single active JWT signing secret, rotation
invalidates existing tokens.

### Rotate device API secrets

Use this path when device-signing secrets may be exposed.

1. Generate new values for `DEVICE_API_SECRET` or each entry in
   `DEVICE_API_SECRETS`.
2. Update the secret store.
3. Redeploy the backend if the runtime does not hot-reload secrets.
4. Update any simulator, device registration workflow, or external hardware
   configuration that depends on the secret.
5. Verify ingest on `/device/v1/pressure`.

If you operate with per-device secrets, rotate the specific affected entries
first and avoid broad fallback secrets in production.

### Rotate third-party provider secrets

For `NOVU_API_KEY` or `ZEGO_SERVER_SECRET`:

1. Create the replacement key in the provider console.
2. Store the new value in Infisical.
3. Deploy the dependent service.
4. Verify the provider-specific flow still works.
5. Revoke the old provider key only after the new path is confirmed healthy.

### Update privileged-access configuration

Treat the following config changes as access-control rotations:

- updating the bootstrap or break-glass fallback list in `SUPER_ADMIN_EMAILS`,
- changing `TRUSTED_PROXY_IPS`.

When you change them:

1. Update the Infisical value.
2. Deploy the backend.
3. Test the affected admin flow in staging or production as appropriate.
4. Record who approved the change.

## Validation checklist

After any rotation, verify the target environment:

- backend starts successfully,
- `/auth/login` works for a normal account,
- admin login still enforces MFA,
- invite flow still works,
- security toolkit actions still work for DB-backed privileged operators,
- device ingest still succeeds if device secrets changed, and
- audit logs continue to record security actions.

## Rollback guidance

If validation fails, use the last known-good secret only long enough to restore
service, then continue incident handling. Do not treat rollback as closure if
the original secret may be exposed.

When you roll back:

1. Record the failure cause.
2. Restore service.
3. Open a follow-up item for a corrected rotation.
4. Keep the exposure classified as unresolved until a safe secret is live.

## Documentation and evidence

For every rotation, record:

- environment,
- secret name,
- reason,
- actor,
- approval reference,
- deployment timestamp, and
- verification result.

Do not store secret values in the ticket or repository.

## Next steps

After you complete a rotation, review related admin recovery and access-control
docs:

- [Admin access policy](/Volumes/P1Back/telemed-monorepo/docs/security/admin-access-policy.md)
- [Privileged admin bootstrap runbook](/Volumes/P1Back/telemed-monorepo/docs/security/privileged-admin-bootstrap-runbook.md)
