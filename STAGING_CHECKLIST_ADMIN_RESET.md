# Staging checklist: admin force password reset and session invalidation

This checklist lets you validate the admin-driven password reset hardening in a
production-like environment. It focuses on session invalidation, trusted device
revocation, backup code revocation, audit logging, and reset-token behavior.

> Target environment: staging or another production-like environment
> Estimated time: 15 minutes
> Prerequisites: admin account, target test user, and access to logs or DB

## Setup

Complete the following setup before you start the test flow.

- [ ] Create or identify an admin account that has access to security recovery
      actions.
- [ ] Create a target test user with role `medical_student`.
- [ ] Sign in as the target user and confirm the current access token can call
      `GET /auth/me`.
- [ ] Register at least one trusted device for the target user through the UI
      or API.
- [ ] Generate one set of backup codes for the target user.
- [ ] Enable 2FA for the target user if you also want to verify MFA artifact
      revocation end to end.
- [ ] Open the audit log viewer or prepare DB access for `audit_logs`,
      `user_trusted_devices`, and `user_backup_codes`.

## Test 1: admin force password reset

Use this test to confirm the admin endpoint succeeds and returns the expected
metadata.

1. Sign in as the admin user.
2. Call `POST /security/users/{target_id}/password/reset` with a non-empty
   `reason`.
3. Save the response payload for later checks.

Expected results:

- [ ] Response status is `200`.
- [ ] Response contains `reset_token_expires_in`.
- [ ] Response contains `revoked_devices` and the value is at least `1` if you
      registered a trusted device during setup.
- [ ] Response contains `revoked_backup_codes` and the value matches the number
      of active backup codes before the reset.
- [ ] Response contains `reset_token` only when the environment is configured
      to return it for local or development use. Production-like environments
      normally must not expose it.

## Test 2: session invalidation for the target user

Use this test to confirm the target user's old session no longer works after
the admin reset.

1. Reuse the access token you saved before the admin reset.
2. Call `GET /auth/me`.

Expected results:

- [ ] Response status is `401`.
- [ ] The old session is rejected because the password version changed.

## Test 3: trusted device revocation

Use this test to verify every trusted device for the target user is revoked.

1. Run a DB query for the target user's trusted devices.

```sql
SELECT id, user_id, revoked_at
FROM user_trusted_devices
WHERE user_id = '<target_id>';
```

Expected results:

- [ ] Every trusted device row for the target user has a non-`NULL`
      `revoked_at`.

## Test 4: backup code revocation

Use this test to verify active backup codes are no longer available.

1. Run a DB query for active backup codes for the target user.

```sql
SELECT id, user_id, used_at
FROM user_backup_codes
WHERE user_id = '<target_id>' AND used_at IS NULL;
```

Expected results:

- [ ] The result set is empty.

## Test 5: audit log verification

Use this test to confirm the successful reset is written to the audit trail
with the expected details.

1. Query the latest `admin_force_password_reset` entry.

```sql
SELECT id, action, status, details, created_at
FROM audit_logs
WHERE action = 'admin_force_password_reset'
ORDER BY created_at DESC
LIMIT 1;
```

Expected results:

- [ ] `status` is `"success"`.
- [ ] `details.target_email` matches the target user email.
- [ ] `details.reason` matches the reason you sent in the request.
- [ ] `details.revoked_devices` matches the number confirmed in Test 3.
- [ ] `details.revoked_backup_codes` matches the number confirmed in Test 4.

## Test 6: reset token usage

Use this test to confirm the newly issued reset token works once.

1. Use the reset token from Test 1 if the environment exposes it.
2. Call `POST /auth/reset-password` with a new password.
3. Sign in with the new password.

Expected results:

- [ ] `POST /auth/reset-password` returns `200`.
- [ ] The target user can sign in with the new password.

> **Note:** If the environment does not expose `reset_token`, complete this
> test by reading the token from the secure delivery mechanism used in staging,
> or mark the test as blocked and document why.

## Test 7: stale reset token rejection

Use this test to confirm an older reset token becomes invalid after a newer
admin reset.

1. Trigger `POST /security/users/{target_id}/password/reset` a second time.
2. Reuse the older reset token from Test 1.
3. Call `POST /auth/reset-password` with the stale token.

Expected results:

- [ ] Response status is `400`.
- [ ] The older reset token is rejected as stale.

## Cleanup

Close the test by removing or documenting the staging data you created.

- [ ] Delete or deactivate the target test user.
- [ ] Remove temporary trusted devices or backup codes if your staging policy
      requires cleanup.
- [ ] Capture the results in the deployment ticket, QA note, or PR comment.

## Test results

Record the outcome of each test case.

| Test | Status | Notes |
| --- | --- | --- |
| 1 |  |  |
| 2 |  |  |
| 3 |  |  |
| 4 |  |  |
| 5 |  |  |
| 6 |  |  |
| 7 |  |  |

## Next steps

If any check fails, attach the API response, DB evidence, and the latest audit
log row to the investigation ticket before promoting the release.
