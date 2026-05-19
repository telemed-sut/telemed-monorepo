# Final security audit summary

This summary closes the application-layer security hardening work completed on
April 10, 2026. It focuses on the shipped codebase and the regression suites
that were executed locally.

## Fixed risks

The following material risks were addressed in this hardening round.

- Staff and admin JWTs now require an active server-side session record and can
  be revoked on logout, password reset, and privileged security flows.
- Sensitive 2FA lifecycle actions now require a recent MFA-backed secure
  session.
- Logout now clears trusted-device cookies so shared browsers do not continue
  to bypass MFA after sign-out.
- Patient app authentication now uses revocable server-side sessions and
  includes a logout endpoint.
- Patient registration and login no longer rely on weak last-four-digit phone
  matching.
- Dashboard route protection now validates the server session instead of
  trusting cookie presence alone.
- Session cleanup for `user_sessions` and `patient_app_sessions` is implemented
  with deterministic retention-based deletion and a cron-friendly one-shot
  script.

## Regression status

The following local verification passed after the final hardening changes.

- Backend auth and runtime suite: `138 passed`
- Frontend auth-adjacent Vitest suite: `19 passed`

These checks cover auth core, 2FA management, admin SSO, patient app auth,
security headers, runtime hardening, session cleanup behavior, dashboard route
protection, auth hydration, and logout state clearing.

## Remaining accepted risks

The following items remain accepted tradeoffs rather than active P1 or P2
findings.

- Frontend CSP still allows `style-src 'unsafe-inline'` because the current UI
  stack depends on it.
- The landing page still decodes the cookie JWT client-side for redirect
  optimization, but authorization is enforced server-side on protected routes.
- Dashboard access depends on backend reachability; when backend validation
  fails, the app redirects to login rather than rendering protected content.
- Dependency audit tooling was partially blocked by network instability, so
  package posture still requires an operator rerun in a network-enabled
  environment before final production sign-off.

## Items needing production access

The following checks cannot be fully proved from the repository alone and
require operator validation in the deployed environment.

- Exact production CORS and allowed-host configuration
- Cookie flags and HTTPS behavior on the real deployment host
- Deployment-scoped rate limiting in the deployed environment
- Log redaction behavior in the production sink
- Monitoring, alerting, and request-ID propagation in production
- Archived dependency audit results from CI or a network-enabled workstation
- Scheduled execution of `backend/scripts/cleanup_sessions.py`

## Sign-off posture

No new P1 or P2 application-layer issue was identified in the final code sweep
performed for this hardening round. Final production sign-off still depends on
the operator-run checklist in
[production-security-readiness-checklist.md](./production-security-readiness-checklist.md),
the execution log in
[production-verification-log-template.md](./production-verification-log-template.md),
and the release record in
[security-sign-off-note-template.md](./security-sign-off-note-template.md).
