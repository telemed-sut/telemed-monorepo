# Frontend security audit report

This report summarizes the auth-adjacent frontend review completed on
April 10, 2026. It focuses on routes and client helpers that influence
authentication, session handling, redirect behavior, and security headers.

The reviewed entrypoints are:

- `login`,
- `logout`,
- admin SSO,
- patient join and call surfaces,
- protected layouts, and
- API client wrappers.

## Fixed issues

The audit confirmed and fixed the following issues in the current codebase.

- Protected dashboard routes now verify the current server session instead of
  checking only for cookie presence.
- Logout flows clear protected client state and revoke the current session.
- Patient app tokens now use server-side sessions and support logout-based
  invalidation.
- Security regression tests now match the current header policy and session
  enforcement behavior.

## Verified behaviors

The current frontend behavior is acceptable for the active security model.

- The auth store persists only the `__cookie_session__` sentinel and user
  metadata, not the raw bearer token.
- Protected dashboard routes now have a regression test that proves cookie
  presence alone is not enough; the layout redirects unless the backend session
  lookup succeeds.
- The API client attaches `X-CSRF-Token` automatically for same-origin
  state-changing requests that use cookies.
- Admin SSO logout uses the backend logout endpoint and follows the
  server-provided redirect.
- Route-level CSP is split between dashboard pages and call surfaces, with
  more permissive `connect-src` only on meeting and patient join pages.
- Protected state is cleared during logout and account-switch flows.

## Accepted risks

The following items remain acceptable tradeoffs for now and do not represent
known P1 or P2 findings.

- `style-src 'unsafe-inline'` remains enabled in the frontend CSP because the
  current UI stack still depends on inline style patterns.
- The landing page still reads the JWT payload client-side to avoid redirecting
  an obviously expired cookie to the dashboard. This does not grant access,
  because protected layouts now verify the session server-side.
- Dashboard route protection depends on backend reachability. If the backend is
  unavailable, the user is redirected to the login page instead of seeing
  protected data.

## Next steps

Use this report together with
[production-security-readiness-checklist.md](./production-security-readiness-checklist.md)
before a production rollout.
