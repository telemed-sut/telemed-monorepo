# Admin access policy

This document defines the production policy for `admin` and `super-admin`
access in Telemed Platform. It covers password handling, MFA, onboarding,
emergency access, and offboarding.

Use this policy together with the operational runbooks in
[admin emergency access runbook](/Volumes/P1Back/telemed-monorepo/docs/security/admin-emergency-access-runbook.md)
and
[secret rotation runbook](/Volumes/P1Back/telemed-monorepo/docs/security/secret-rotation-runbook.md).

## Scope

This policy applies to any account that can:

- manage users or invites,
- access the **Security** or **Audit logs** areas,
- reset another user's password or 2FA state,
- unlock admin accounts, or
- change system-wide security configuration.

In the current implementation, privileged access is DB-backed. Every operator
starts as an `admin` account in the `users` table, then receives one or more
privileged role assignments. `SUPER_ADMIN_EMAILS` remains only as a bootstrap
and break-glass fallback.

## Access model

Telemed Platform uses the following production model for privileged access:

- Every admin must have a unique personal account.
- Shared admin accounts are not permitted.
- `admin` accounts must complete 2FA before the session is usable.
- Privileged access is granted through DB-backed role assignments such as
  `platform_super_admin`, `security_admin`, and `hospital_admin`.
- `SUPER_ADMIN_EMAILS` is reserved for initial bootstrap and controlled
  break-glass fallback, not normal daily operations.
- New `admin` accounts must be created through invite flow.
- Only operators with privileged admin-management access may issue `admin`
  invites.

This repository does not implement a permanent application-level
"break-glass user" account. Emergency recovery uses controlled privileged
roles, recent MFA verification, and the dedicated emergency unlock tooling.

## Password policy

This section defines how you must handle admin passwords in production.

- Generate passwords in a password manager. Do not invent memorable passwords.
- Use randomly generated passwords with at least 20 characters.
- Do not reuse admin passwords across environments.
- Do not store admin passwords in Infisical, `.env` files, chat history, or
  project docs.
- Do not share admin passwords between operators.
- Regenerate the password immediately after suspected exposure, device loss, or
  staff transition.

The system stores only password hashes in the database. User passwords are not
system secrets and must not be treated like `DATABASE_URL` or `JWT_SECRET`.

## Password manager policy

Admin credentials must live in an approved password manager such as 1Password
or Bitwarden. The password manager is the source of truth for operator-held
credentials.

Each admin record in the password manager must contain:

- the environment name,
- the account email,
- the date the credential was created or rotated,
- which privileged roles the account holds,
- the location of the current backup codes, and
- the ticket or approval reference for recent emergency actions.

If your organization needs an emergency escrow record, keep that record in a
restricted shared vault, not in Infisical and not in source control.

## MFA policy

Every `admin` account must satisfy the following controls:

- Enable TOTP-based 2FA before first real use.
- Generate backup codes and store them in the same password manager item as the
  password, or in a tightly scoped linked item.
- Review trusted devices after any workstation change or suspected compromise.
- Revoke trusted devices after password reset, staff transition, or emergency
  recovery.

The current backend policy enforces admin 2FA and supports:

- TOTP verification,
- backup codes,
- trusted devices, and
- security-admin 2FA reset flows.

The current session model also distinguishes between routine protected work and
higher-risk recovery actions:

- routine protected actions use a 4-hour secure verification window,
- higher-risk recovery and privileged-management actions require fresher MFA,
  and
- admin browser sessions use a longer rolling session TTL than standard users.

## Onboarding policy

Admin onboarding must follow this sequence:

1. An operator with privileged admin-management access creates an `admin`
   invite and records a reason.
2. The invite recipient opens the one-time invite link.
3. The recipient sets a new password during invite acceptance.
4. The recipient completes 2FA setup and stores backup codes.
5. The privileged operator verifies the new admin can sign in and reach the
   required areas.

Do not create production admin accounts with preset passwords.

## Offboarding policy

When an admin leaves the team or loses privileged access, you must complete
these steps on the same day:

1. Revoke active privileged role assignments for the account.
2. Remove the account from `SUPER_ADMIN_EMAILS` if it is still present there
   as a bootstrap fallback.
3. Disable or delete the user account according to your HR and audit policy.
4. Revoke trusted devices.
5. Rotate any shared recovery material associated with that operator.
6. Review audit logs for the last 30 days.

If the departing operator had access to shared secret stores, run the
[secret rotation runbook](/Volumes/P1Back/telemed-monorepo/docs/security/secret-rotation-runbook.md).

## Break-glass policy

Telemed Platform currently uses a controlled recovery model instead of a
permanent interactive break-glass account.

That means:

- normal recovery uses DB-backed privileged tooling,
- emergency account unlock uses audited unlock actions,
- patient break-glass access remains disabled by policy in this phase, and
- any dormant emergency credential must live outside the app in an approved
  vault with explicit access review.

If your organization later introduces a true break-glass account, it must meet
all of these requirements:

- owned by the organization, not by an individual,
- stored in a restricted shared vault,
- protected by offline or dual-control recovery instructions,
- monitored with alerting on every use, and
- reviewed at least monthly.

## Data handling rules

Use the following storage rules consistently:

- Store system secrets in Infisical.
- Store admin passwords and backup codes in a password manager.
- Store invite URLs only for immediate delivery. Do not archive them in docs or
  tickets.
- Store operational approvals and incident references in your ticketing system.

## Review cadence

Review this policy on each production auth hardening milestone and at least
once per quarter.

At every review, confirm:

- DB-backed privileged role assignments are current,
- `SUPER_ADMIN_EMAILS` is limited to bootstrap and break-glass fallback,
- whitelisted unlock IPs are still valid,
- invite-only admin onboarding is still enforced,
- 2FA remains mandatory for admins, and
- admin session TTL and secure-action windows still match the deployed policy,
- runbooks still match the deployed system behavior.

## Next steps

After you adopt this policy, make sure operators can execute the associated
runbooks without improvisation:

- [Privileged admin bootstrap runbook](/Volumes/P1Back/telemed-monorepo/docs/security/privileged-admin-bootstrap-runbook.md)
- [Admin emergency access runbook](/Volumes/P1Back/telemed-monorepo/docs/security/admin-emergency-access-runbook.md)
- [Admin session validation checklist](/Volumes/P1Back/telemed-monorepo/docs/security/admin-session-validation-checklist.md)
- [Secret rotation runbook](/Volumes/P1Back/telemed-monorepo/docs/security/secret-rotation-runbook.md)
