# Admin emergency access runbook

This runbook describes how to recover privileged access when an admin account
is locked, loses 2FA access, or cannot complete onboarding. It maps directly
to the current backend and frontend behavior in this repository.

Use this document during incidents. For standing policy, see
[admin access policy](/Volumes/P1Back/telemed-monorepo/docs/security/admin-access-policy.md).
For first-time environment setup, use the
[privileged admin bootstrap runbook](/Volumes/P1Back/telemed-monorepo/docs/security/privileged-admin-bootstrap-runbook.md).

## What the system supports today

Telemed Platform currently provides these recovery mechanisms:

- `POST /security/admin-unlock` for audited admin unlock by operators with
  `security_admin` or `platform_super_admin`,
- `backend/scripts/emergency_unlock_admin.py` for CLI-based emergency unlock,
- security-admin password reset and 2FA reset controls in the security toolkit,
- invite-based admin onboarding,
- mandatory admin 2FA, backup codes, and trusted-device support.

Patient break-glass access exists in code, but the feature is disabled by
policy in this phase.

## Before you start

Before you perform any emergency action, verify these conditions:

1. Confirm the target account email and environment.
2. Record the incident or ticket ID that justifies the action.
3. Verify whether the operator is only locked out, or whether they also lost
   access to their authenticator and backup codes.
4. Use a `security_admin` or `platform_super_admin` account if one is still
   available.
5. Use the CLI script only if the normal admin security flow is unavailable.

## Decision guide

Use the lightest recovery action that solves the incident:

- If the account is locked due to failed login attempts, use **admin unlock**.
- If the operator still has password access but lost the authenticator, use
  **2FA reset by security admin**.
- If the operator forgot the password, use **super-admin password reset** or
  reissue onboarding through invite flow.
- If no admin can sign in, use the **CLI emergency unlock script** from a
  controlled environment.

## Normal recovery path: security API or dashboard

Use the built-in security tools whenever at least one privileged recovery
operator can still sign in.

### Unlock a locked admin account

Use this flow when the target account is locked but its owner still controls
their password and authenticator.

1. Sign in as a `security_admin` or `platform_super_admin`.
2. Open the **Security** area in the dashboard, or call
   `POST /security/admin-unlock`.
3. Supply the target email or user ID and a reason tied to the incident.
4. Confirm the response reports `was_locked=true` or confirms the account state
   was cleared.
5. Ask the target admin to sign in again.

Every unlock action writes the `admin_emergency_unlock` audit event.

### Reset an admin's 2FA state

Use this flow when the target admin lost their authenticator and cannot use
backup codes.

1. Sign in as a `security_admin` or `platform_super_admin`.
2. Resolve the target user in the **Security** toolkit.
3. Trigger the 2FA reset action with a reason.
4. Confirm the user is now in `setup_required` state.
5. Ask the target admin to sign in and complete 2FA setup again.
6. Verify they regenerate and store fresh backup codes.

This flow revokes trusted devices and backup codes for the target account.

### Reset an admin password

Use this flow when the admin cannot remember the password but still owns the
account email.

1. Sign in as a `security_admin` or `platform_super_admin`.
2. Resolve the target admin in the **Security** toolkit.
3. Trigger the password reset action with an incident reason.
4. Deliver the resulting reset token or recovery link through an approved
   secure channel.
5. Confirm the target admin completes password reset and can sign in again.
6. Confirm old sessions are invalidated.

Do not paste reset tokens into tickets, wiki pages, or long-lived chat
threads.

## Fallback path: CLI emergency unlock

Use the script only when the dashboard or security API is unavailable or when
no trusted privileged recovery session is active.

The script is
[backend/scripts/emergency_unlock_admin.py](/Volumes/P1Back/telemed-monorepo/backend/scripts/emergency_unlock_admin.py).

The script authorizes the action by either:

- matching `--requester-email` against `SUPER_ADMIN_EMAILS` for bootstrap or
  break-glass fallback, or
- matching `--requester-ip` against `ADMIN_UNLOCK_WHITELISTED_IPS`.

Run the command from the backend environment with production secrets loaded:

```bash
cd /Volumes/P1Back/telemed-monorepo/backend
python -m scripts.emergency_unlock_admin \
  --email target-admin@example.com \
  --reason "INC-1234 emergency unlock" \
  --requester-email super-admin@example.com \
  --requester-ip 203.0.113.10
```

If the requester email is unavailable but you are operating from a sanctioned
host, you may use the whitelisted IP path instead. That path must remain rare
and auditable.

## Post-recovery verification

After any recovery action, verify these outcomes:

1. The target account can sign in if it is expected to.
2. The account still requires 2FA if the policy applies.
3. Trusted devices are revoked if the incident involved lost control of the
   credential.
4. The relevant audit events appear in **Audit logs**.
5. The incident ticket records who executed the action, why, and at what time.

## Required audit evidence

Capture these details in your incident record:

- target email,
- acting privileged operator,
- environment,
- reason for the action,
- timestamp,
- whether password reset or 2FA reset was also performed, and
- the audit log event IDs if your process tracks them.

## Aftercare

Complete the following actions after recovery:

- Tell the target admin to regenerate backup codes if 2FA was reset.
- Revoke stale trusted devices if compromise is suspected.
- Rotate the password if there is any doubt about credential exposure.
- Review nearby audit log activity for the account.
- If the incident exposed broader secrets, run the
  [secret rotation runbook](/Volumes/P1Back/telemed-monorepo/docs/security/secret-rotation-runbook.md).

## Failure conditions

Escalate immediately if any of these conditions is true:

- the target account is not an `admin`,
- the unlock action fails authorization,
- the password reset token cannot be delivered securely,
- the audit log does not record the emergency action, or
- multiple admin accounts show related lockouts at the same time.

## Next steps

Keep this runbook aligned with the deployed security tooling. Whenever you
change admin recovery behavior in code, update this file in the same change set.
