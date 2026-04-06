## [Unreleased]

### Fixed

- Hardened emergency admin password reset so it now invalidates existing access sessions, revokes trusted devices and backup codes, and records revoked artifact counts in security audit logs.
- Tightened password reset token validation to reject stale tokens while keeping newly issued emergency reset tokens valid after password version changes.
- Prevented protected dashboard pages from hydrating persisted auth snapshots or cached patient workspace data before server-side session revalidation succeeds, and cleared protected client caches on logout or invalid session recovery.
