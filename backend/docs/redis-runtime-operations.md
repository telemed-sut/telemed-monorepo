# Redis Runtime Operations

This document captures the Redis-backed runtime patterns currently used by the backend, along with the intended fallback behavior and TTL policy.

## Goals

- Keep PostgreSQL as the source of truth for business and compliance data.
- Use Redis for shared runtime state, short-lived security artifacts, and hot-path caches.
- Make fallback behavior explicit so multi-instance environments do not silently degrade into unsafe local state.

## Runtime Policy

### Shared runtime state

These flows must use Redis-backed shared state outside `development` and `test`:

- Passkey registration/authentication challenges
- Admin SSO login artifacts
- Admin SSO logout hints

If Redis is unavailable in non-development environments, these flows fail closed instead of falling back to process memory.

### Best-effort runtime state

These flows may degrade gracefully when Redis is unavailable:

- Dashboard stats cache
- Device secret cache
- Realtime pub/sub fanout
- Global presence index
- Audit log buffering
- Idempotency cache
- Distributed locks in `development` and `test`

## Redis Key Policy

Use namespaced, versioned keys:

- `passkey:challenge:<sha256(session_id)>`
- `admin_sso:state:<sha256(state_token)>`
- `admin_sso:logout_hint:<sha256(session_id)>`
- `session:user:v1:<sha256(session_id)>`
- `session:patient_app:v1:<sha256(session_id)>`
- `stats:overview:v3:<namespace>:<role>:<user_id>:<year>`
- `stats:overview:v3:namespace`
- `device_secret:v1:<device_id>`
- `idempotency:v1:<user_id>:<key>`
- `presence:online_users:v1`
- `audit_log:buffer:v1`

## TTL Matrix

### Security and auth artifacts

- Passkey challenge: `300s`
- Device nonce replay key: `DEVICE_API_NONCE_TTL_SECONDS` (default `300s`)
- Admin SSO state token: `ADMIN_OIDC_STATE_TTL_SECONDS` (default `600s`)
- Admin SSO metadata cache: `ADMIN_OIDC_CACHE_TTL_SECONDS` (default `3600s`)

### Session and login-adjacent state

- Staff/admin session cache: derived from DB session expiration
- Patient app session cache: derived from DB session expiration
- Trusted-device data: stored in PostgreSQL, not Redis

### Cached lookups and hot reads

- Dashboard stats cache: `300s`
- Device secret cache: `3600s`
- Patient registration cache: derived from registration expiry
- Meeting invite code cache: derived from invite expiry
- Meeting presence overlay: `max(heartbeat_timeout * 4, 120s)`

### Realtime and buffering

- Global presence set: bounded by `PRESENCE_TIMEOUT_SECONDS` with score-based cleanup
- Audit buffer: no TTL currently; intended only as a short-lived queue-like buffer

## Invalidation Policy

### Dashboard stats

Dashboard stats invalidation uses namespace bumping instead of `KEYS` scans:

- Read key format: `stats:overview:v3:<namespace>:...`
- Invalidate by incrementing `stats:overview:v3:namespace`

This avoids blocking Redis with wide key scans as key volume grows.

## Health and Diagnostics

`GET /health` now exposes `redis_runtime` diagnostics:

- `unavailable_scopes`
- `unavailable_scope_counts`
- `unavailable_scope_total`
- `degraded_scope_count`
- `last_unavailable_at`
- `operation_failures`
- `operation_failure_total`
- `last_operation_failure_at`

This is best-effort in-process visibility intended to help operators quickly identify which Redis-backed features are currently degrading.

`GET /health` also emits a structured `redis_runtime_snapshot` log event when the runtime snapshot changes and there is at least one degraded scope or Redis operation failure. This keeps log-based monitoring pipelines informed without logging the same snapshot repeatedly on every health probe.

`GET /health` additionally exposes `redis_runtime_alert`, a threshold-based alert summary derived from runtime diagnostics:

- `status`: `ok`, `warning`, or `critical`
- `should_alert`
- `reasons`
- `degraded_scope_threshold`
- `operation_failure_threshold`

The default thresholds are:

- `REDIS_RUNTIME_DEGRADED_SCOPE_ALERT_THRESHOLD=1`
- `REDIS_RUNTIME_OPERATION_FAILURE_ALERT_THRESHOLD=5`

When `redis_runtime_alert.should_alert` is true and the alert snapshot changes, the backend emits a structured `redis_runtime_alert` log event so external monitoring can wire alerts from logs without scraping Redis internals directly.

## What Redis Should Not Store

Do not use Redis as the source of truth for:

- Patient records
- Meetings and appointments
- Audit log retention
- Authorization assignments
- Long-term analytics or reporting

Keep those in PostgreSQL.
