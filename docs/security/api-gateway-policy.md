# Azure API gateway policy

This document defines the edge and gateway controls for the telemed API when
the system runs on Azure. It complements the application controls in FastAPI:
JWT and patient-token validation, object-level authorization, device HMAC
verification, audit logging, and MFA freshness checks must stay in the
backend.

## Recommended Azure layout

Use Azure Front Door Premium with WAF as the public entry point. Add Azure API
Management only when you need per-operation policies, subscription keys,
client-specific quota, or request shaping beyond WAF path rules.

The recommended request path is:

```text
Internet -> Azure Front Door Premium + WAF -> Azure API Management -> Backend
```

For a smaller deployment, you can start with:

```text
Internet -> Azure Front Door Premium + WAF -> Backend
```

The backend must not accept direct public traffic when an edge layer is active.
Restrict the app ingress to Azure Front Door, API Management, a private network,
or an approved reverse proxy.

## Required backend configuration

Set these values in Azure App Service, Azure Container Apps, or the selected
runtime configuration source.

| Setting | Production value |
| --- | --- |
| `APP_ENV` | `production` |
| `ALLOWED_HOSTS` | Comma-separated public API and frontend hostnames |
| `CORS_ORIGINS` | Comma-separated approved frontend origins |
| `RATE_LIMIT_STORAGE_URI` | `memory://`, unless an approved shared store is deployed |
| `RATE_LIMIT_WHITELIST` | Only trusted internal monitoring IPs |
| `TRUSTED_PROXY_IPS` | Only the direct trusted reverse proxy addresses |
| `API_DOCS_ENABLED` | `false`, unless approved for a private environment |

Keep `RATE_LIMIT_STORAGE_URI=memory://` when Azure Front Door WAF or API
Management provides the deployment-wide rate limit. With `memory://`, backend
limits are per instance and act as a second layer of defense, not as the global
quota source.

## Edge policy matrix

Apply these policies at Azure Front Door WAF. If APIM is present, mirror the
same operation groups with `rate-limit-by-key` or `quota-by-key` policies.

| API group | Paths | Front Door WAF policy | Backend control |
| --- | --- | --- | --- |
| Health | `/`, `/health`, `/health/live` | Allow, limit to 60 requests per minute per IP | Strict IP limiter |
| Staff auth | `/auth/login`, `/auth/forgot-password`, `/auth/reset-password` | Limit to 5-10 requests per minute per IP | Login attempt tracking, IP ban, session validation |
| Admin SSO | `/auth/admin/sso/*` | Limit callback to 10 requests per minute per IP | OIDC state, MFA, admin session policy |
| Patient auth | `/patient-app/register`, `/patient-app/login` | Limit to 5-10 requests per minute per IP | PIN lockout, patient session validation |
| Passkeys | `/passkeys/login-options`, `/passkeys/login-verify`, `/passkeys/register-*` | Limit login verification to 10 requests per minute per IP | WebAuthn challenge validation |
| Device ingest | `/device/v1/pressure`, `/device/v1/heart-sounds`, `/device/v1/lung-sounds`, `/add_pressure` | Limit to 60 requests per minute per IP, cap body size | Device HMAC, nonce, registered device checks |
| Staff clinical read | `/patients/*`, `/meetings/*`, `/stats/*`, `/alerts/*` | Limit to 100-200 requests per minute per authenticated client | JWT, RBAC, patient assignment checks |
| Staff clinical write | Patient, meeting, note, order, alert acknowledgement writes | Limit to 20-60 requests per minute per authenticated client | RBAC, audit logs, business rules |
| Security admin | `/security/*`, `/audit/*`, `/users/*` | Limit to 10-30 requests per minute; consider office, VPN, or APIM allowlist | Admin role, privileged role, recent MFA |
| Audit export | `/audit/export` | Limit to 5 requests per minute; consider private access only | Security-admin authorization, audit trail |
| Realtime streams | `/events/users`, `/device-sessions/events/stream`, `/patient-app/me/stream`, `/patients/*/stream` | Limit connection attempts and concurrent sessions | JWT or patient-token validation |
| File and audio access | `/patients/*/heart-sounds/upload*`, `/heart-sounds/local/*` | Cap body size, restrict content types where possible | Patient access, storage authorization |
| Dev-only helpers | `/patient-app/*/test-notification` | Block in production | `APP_ENV` production guard |

## APIM policy guidance

Use APIM when you need policy decisions that WAF cannot express cleanly.

- Use IP-based keys for unauthenticated flows.
- Use hashed JWT subject, subscription ID, or client ID for authenticated
  flows.
- Use hospital or device identity for device clients only after the request has
  passed trusted authentication.
- Return standard `429` responses with `Retry-After`.
- Do not move patient-object authorization into APIM. The backend must keep
  database-backed checks such as doctor-patient assignment and privileged admin
  role validation.

## Backend limits

The backend keeps SlowAPI limits as the second layer of defense. These limits
protect direct internal traffic, accidental APIM bypass, and application-aware
flows that require JWT, patient-token, or device context.

The backend now uses explicit route limits for admin user management, passkey
flows, realtime stream entry points, and local heart sound file serving. The
rate-limit storage backend is configurable through `RATE_LIMIT_STORAGE_URI`,
but the default deployment posture does not require Redis.

## Verification

Run these checks before production sign-off.

1. Send a request through the public Azure Front Door hostname and confirm it
   reaches the backend.
2. Send a request directly to the backend origin and confirm it is blocked by
   network, ingress, or host policy.
3. Exceed the login limit and confirm the edge returns `429`.
4. Exceed the patient PIN attempt limit and confirm the backend lockout still
   applies.
5. Submit device ingest without a valid signature and confirm the backend
   rejects it.
6. Open more realtime streams than the approved threshold and confirm the edge
   or APIM rejects new connections.
7. Confirm `/docs`, `/redoc`, and `/openapi.json` are disabled or private in
   production.
8. Confirm request IDs and 401, 403, and 429 events are visible in Azure logs.

## References

- Azure Front Door WAF rate limiting:
  https://learn.microsoft.com/azure/web-application-firewall/afds/waf-front-door-rate-limit
- Azure API Management rate limit policy:
  https://learn.microsoft.com/azure/api-management/rate-limit-by-key-policy
- Azure Container Apps ingress:
  https://learn.microsoft.com/azure/container-apps/ingress-overview
