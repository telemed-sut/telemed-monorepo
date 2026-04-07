## [Unreleased]

### Fixed

- Hardened emergency admin password reset so it now invalidates existing access sessions, revokes trusted devices and backup codes, and records revoked artifact counts in security audit logs.
- Tightened password reset token validation to reject stale tokens while keeping newly issued emergency reset tokens valid after password version changes.
- Prevented protected dashboard pages from hydrating persisted auth snapshots or cached patient workspace data before server-side session revalidation succeeds, and cleared protected client caches on logout or invalid session recovery.
- Hardened CSRF validation for cookie-based auth, requiring valid Origin/Referer or X-CSRF-Token header on state-changing requests.
- Added Content-Security-Policy header to all backend responses to mitigate XSS and data injection attacks.
- Changed auth cookie secure default to True, preventing cookie leakage over unencrypted connections.
- Made bulk patient delete atomic with transaction rollback and a maximum batch size of 100.
- Enforced CI lint gating on all frontend files and made dependency vulnerability scans blocking.
- Tuned database connection pool (pool_size, max_overflow, pool_recycle) to prevent stale connections on Cloud Run.
- Bounded IP ban cache to 10,000 entries using LRU eviction to prevent memory exhaustion during attacks.
- Added Redis-backed rate limiting shared across Cloud Run instances with fail-fast validation at startup.
- Moved meeting presence reconciliation from inline GET handler to a background lifecycle worker.
- Cascade delete pressure_records and heart_sound_records when soft-deleting a patient.
- Enabled React StrictMode in production builds to catch concurrency bugs.
- Scoped patient notifications to assigned doctors and admins only, reducing PHI exposure.
- Ran database migrations before backend deployment in CI to ensure schema compatibility.
- Modularized backend auth and frontend API layer into focused modules with backward-compatible re-exports.
