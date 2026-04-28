# Admin session validation checklist

Use this checklist after you change admin sign-in, cookie policy, session TTL,
or MFA behavior. It helps you confirm that the deployed system matches the
current access policy and that admins don't get logged out unexpectedly during
normal work.

This checklist covers the current model:

- admin accounts require 2FA,
- routine protected actions use a 15-minute secure verification window,
- higher-risk recovery and privileged-management actions require fresher MFA,
  and
- admin sessions use a 4-hour rolling session TTL.

## Before you start

Make sure the target environment is configured with the current auth values
before you begin testing.

- Confirm `JWT_EXPIRES_IN` matches the standard user token lifetime.
- Confirm `ADMIN_JWT_EXPIRES_IN=14400` unless your policy intentionally
  differs.
- Confirm `PRIVILEGED_ACTION_MFA_MAX_AGE_SECONDS=900` unless your policy
  intentionally differs.
- Confirm `ADMIN_TRUSTED_DEVICE_DAYS=1` and `USER_TRUSTED_DEVICE_DAYS=7`
  unless your policy intentionally differs.
- Confirm `AUTH_COOKIE_SECURE=true` on HTTPS environments.
- Confirm `FRONTEND_BASE_URL`, `CORS_ORIGINS`, and admin SSO redirect URIs
  match the exact deployed origin.

## Core admin session checks

Run these checks in the same browser profile and on the same machine.

1. Sign in with an `admin` account.
2. Complete 2FA and, when prompted, enable **Trust this device**.
3. Open the dashboard and confirm the secure-session badge appears.
4. Refresh the page and confirm you stay signed in.
5. Open a new tab to the dashboard and confirm you stay signed in.
6. Leave the tab idle for at least 10 minutes, then continue working.
7. Confirm routine navigation still works without a forced return to
   `/login`.

## Protected-action checks

Run these checks after the initial sign-in succeeds.

1. Reveal protected patient contact details.
2. Confirm the first protected action can require secure re-auth if the secure
   window is not active yet.
3. Repeat the same protected action within the next few minutes.
4. Confirm the system does not ask for 2FA again during the active secure
   window.
5. Wait until the routine secure window expires.
6. Trigger another protected action.
7. Confirm the system asks for secure re-auth again.

## High-risk action checks

Use actions such as privileged admin invite issuance, admin 2FA reset, admin
password reset, or security recovery tooling.

1. Complete a fresh secure re-auth.
2. Trigger one high-risk action and confirm it succeeds.
3. Wait longer than the high-risk freshness window.
4. Trigger another high-risk action.
5. Confirm the system asks for fresh MFA again even if the general secure
   session indicator still shows time remaining.

## Logout-reason checks

Use these checks to confirm the user-facing error messages remain clear.

1. Force a real logout from the UI and confirm the app returns to `/login`
   without a misleading session-expired error.
2. Let the admin session expire naturally.
3. Confirm the login page explains whether the session expired, the refresh
   failed, or the session was missing.

## SSO checks

Run these checks only when admin SSO is enabled in the target environment.

1. Sign in through the Organization SSO button.
2. Confirm the callback returns you to the expected dashboard route.
3. Refresh the page and open a new tab.
4. Confirm the browser keeps the admin session active.
5. Sign out and confirm federated logout redirects cleanly.

## Expected results

You can mark the validation as successful when all of these statements are
true:

- The admin can work across refreshes and new tabs without being logged out too
  early.
- Routine protected actions do not re-prompt for MFA during the active secure
  window.
- High-risk actions still require fresher MFA than routine protected actions.
- The login page shows a clear reason when the browser returns there because of
  session expiry or refresh failure.
- Trusted-device behavior reduces repeated prompts on the same browser as
  expected.

## Next steps

If any check fails, capture the exact route, browser, local time, and visible
error state. Then compare the deployed environment values with
[backend/.env.example](/Volumes/P1Back/telemed-monorepo/backend/.env.example)
and
[infra/staging/.env.example](/Volumes/P1Back/telemed-monorepo/infra/staging/.env.example)
before you start debugging application code.
