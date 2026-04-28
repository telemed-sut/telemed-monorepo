# Admin SSO (`authentik`) runbook

This runbook covers the Phase 1 admin identity layer for local and staging
environments.

## Goal

Use `authentik` as the identity provider for `admin` accounts while keeping:

- app authorization in the database,
- privileged roles in `user_privileged_role_assignments`, and
- `SUPER_ADMIN_EMAILS` as bootstrap or break-glass fallback only.

## Local bring-up

1. Set these runtime variables for the backend:
   - `ADMIN_OIDC_ENABLED=true`
   - `ADMIN_OIDC_ENFORCED=true` when you want non-bootstrap admins to use SSO only
   - `ADMIN_JWT_EXPIRES_IN=43200` unless your environment intentionally uses a different admin session TTL
   - `PRIVILEGED_ACTION_MFA_MAX_AGE_SECONDS=14400` unless your environment intentionally uses a different routine secure-action window
   - `ADMIN_OIDC_ISSUER_URL=http://localhost:9000/application/o/telemed-admin`
   - `ADMIN_OIDC_CLIENT_ID=telemed-admin`
   - `ADMIN_OIDC_CLIENT_SECRET=<client secret from authentik>`
   - `ADMIN_OIDC_REDIRECT_URI=http://localhost:3000/api/auth/admin/sso/callback`
   - `ADMIN_OIDC_POST_LOGOUT_REDIRECT_URI=http://localhost:3000/login`
   - `ADMIN_OIDC_CACHE_TTL_SECONDS=3600`
   - `REDIS_URL=redis://localhost:6379/0` when you want durable transient storage across multiple backend instances
2. Start the local identity profile:

```bash
COMPOSE_PROFILES=identity ./scripts/dev-backend.sh
```

3. Keep the frontend running on `http://localhost:3000`.

## Required `authentik` setup

Create one application/provider pair for the admin web flow:

- provider type: OAuth2/OpenID Connect
- client type: confidential
- redirect URI: `http://localhost:3000/api/auth/admin/sso/callback`
- post-logout redirect URI: `http://localhost:3000/login`
- scopes: `openid profile email`
- PKCE: supported automatically by the app; keep authorization code flow enabled

Recommended policy setup:

- enforce MFA or passkey for the admin application,
- emit `groups` claim if you use `ADMIN_OIDC_REQUIRED_GROUP`,
- keep admin users on unique personal identities, and
- do not use shared organization identities.

## App behavior

- `GET /auth/admin/sso/status` exposes whether admin SSO is enabled and enforced.
- `GET /auth/admin/sso/login` starts the redirect flow with `state`, `nonce`, and PKCE (`S256`).
- `GET /auth/admin/sso/callback` exchanges the code, validates claims, and issues the app cookie session.
- `GET /auth/admin/sso/logout` clears the local cookie session and hands off federated logout when supported.

Transient SSO artifacts are now stored server-side:

- login artifacts contain `state`, `nonce`, `code_verifier`, and `next_path`,
- logout artifacts keep `id_token_hint` off the browser and on the server side,
- Redis is preferred when `REDIS_URL` is configured, and
- local/dev falls back to an in-memory TTL store in a single-process setup.

The app only admits SSO identities that:

- resolve to an existing active `admin` account,
- satisfy any configured domain/group restrictions, and
- present MFA-capable claims when admin MFA policy requires it.

The app does not grant privileged roles from IdP claims in this phase.

## Bootstrap and fallback

- Bootstrap accounts in `SUPER_ADMIN_EMAILS` can still use local password login when `ADMIN_OIDC_ENFORCED=true`.
- On backend startup, matching `admin` users from `SUPER_ADMIN_EMAILS` are backfilled into DB-backed `platform_super_admin` assignments if they do not already have one.
- All other admin accounts should use Organization SSO once enforcement is enabled.
- Keep the bootstrap list short and review it regularly.

Recommended migration path:

1. Keep `SUPER_ADMIN_EMAILS` limited to the named bootstrap or break-glass operators.
2. Restart the backend and confirm the startup backfill created the expected `platform_super_admin` assignments.
3. Verify privileged actions work from DB-backed roles in `GET /auth/me`.
4. Reduce the env list again after DB-backed access is confirmed.

## Verification checklist

1. `GET /auth/admin/sso/status` reports `enabled=true`.
2. Clicking `Continue with Organization SSO` redirects to Authentik.
3. Successful callback returns to `/patients` and `/auth/me` reports:
   - `auth_source = "sso"`
   - `sso_provider = "authentik"`
4. No `id_token` logout cookie is present in the browser.
5. SSO callback errors distinguish between:
   - `missing_state_cookie`
   - `expired_sso_session`
   - `invalid_state`
6. Privileged actions still depend on DB-backed privileged roles.
7. Audit logs contain:
   - `admin_sso_login_success`
   - `admin_sso_login_denied`
   - `admin_sso_claim_mismatch`
   - `admin_sso_group_denied`
   - `admin_sso_logout`

For broader browser and secure-session validation after SSO changes, use the
[admin session validation checklist](/Volumes/P1Back/telemed-monorepo/docs/security/admin-session-validation-checklist.md).
