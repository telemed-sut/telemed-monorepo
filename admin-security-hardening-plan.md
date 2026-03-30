# Admin security hardening plan

## Goal
Move the admin and account-recovery model toward hospital-grade production
security without breaking the current product unnecessarily.

## Tasks
- [ ] Lock down runtime defaults so production never auto-seeds demo users and bootstrap actions are always explicit. -> Verify: docker and env examples default `RUN_SEED_ON_STARTUP` to `false`, and backend startup logs show seed is skipped unless opted in.
- [ ] Remove or quarantine legacy token-in-URL flows for invite and password reset. -> Verify: no supported flow depends on path/query tokens reaching the server, and legacy surfaces are either disabled or clearly isolated.
- [ ] Replace env-only super-admin assignment with a durable, audited privilege model in the app. -> Verify: privileged-role assignment is persisted, auditable, and no longer depends on a simple email allowlist for day-to-day operation.
- [ ] Strengthen privileged actions with step-up authentication and tighter policy controls. -> Verify: admin creation, admin recovery, and emergency unlock require stronger checks and produce audit events.
- [ ] Harden browser auth and session handling to remain cookie-first with no accidental bearer-token fallback for normal web traffic. -> Verify: web flows use `HttpOnly` cookies only, and auth tests still pass.
- [ ] Tighten operational controls around docs exposure, secret handling, logging, and deployment runbooks. -> Verify: startup docs and examples reflect production-safe defaults, and risky toggles are documented as local-only.
- [ ] Add and update tests for the hardened behavior. -> Verify: targeted backend and frontend security tests pass.

## Done when
- [ ] Production defaults are safe by default.
- [ ] Demo/bootstrap behavior requires explicit operator intent.
- [ ] Admin privileges follow least privilege and are fully auditable.
- [ ] Recovery and onboarding flows no longer rely on URL-borne secrets.
