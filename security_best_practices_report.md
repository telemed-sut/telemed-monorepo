# Security best practices report

This report summarizes a repo-wide security review of the JavaScript/
TypeScript and Python code in `/Volumes/P1Back/telemed-monorepo` on
March 10, 2026. The review focused on the Next.js frontend, the FastAPI
backend, and shared scripts/configuration. Dart code under `mobile/` was not
reviewed in depth because it is outside the active skill coverage.

## Executive summary

The highest-risk issues are around secret handling and trust boundaries:
password-reset and invite secrets are carried in URLs, doctor-only patient-app
registration code issuance skips assignment checks, and the frontend keeps
Bearer tokens in script-readable state even though the backend already issues
an `HttpOnly` session cookie. These three issues materially increase account
takeover risk if an attacker gets log/referrer access, compromised admin
access, or any frontend XSS foothold.

The next set of issues are production hardening gaps. IP-based controls are
not proxy-aware in the same way as the rest of the application, so rate limits
and IP bans can become inaccurate behind Cloudflare, nginx, or Cloud Run style
deployments. The patient join flow also loads a privileged third-party video
SDK directly from `unpkg.com`, without any in-repo CSP or integrity controls.

## High severity findings

### SEC-001: Sensitive reset and invite tokens are transported in URLs

- Severity: High
- Location:
  - `backend/app/api/users.py:392-411`
  - `backend/app/api/users.py:838-860`
  - `frontend/app/forgot-password/forgot-password-client.tsx:107-113`
  - `frontend/app/reset-password/page.tsx:14-18`
  - `frontend/lib/api.ts:519-528`
- Evidence:
  - User invites are issued as
    `f"{settings.frontend_base_url.rstrip('/')}/invite/{raw_token}"`.
  - The forgot-password screen builds
    `/reset-password?token=${encodeURIComponent(resetToken)}`.
  - The reset-password page reads `searchParams?.token`.
  - The frontend fetches invite metadata via `GET /auth/invite/{token}`.
- Impact: These values are bearer-style secrets. Putting them in paths and
  query strings leaks them into browser history, reverse-proxy logs, analytics,
  referrer headers, screenshots, and support tooling. Anyone who obtains the
  URL can accept an invite or reset a password.
- Fix: Move secret transport out of the URL. Use a short opaque lookup code in
  the URL and exchange it via a POST body, or move the secret into a one-time
  cookie-bound flow. For resets, prefer a POSTed token from a form field or a
  fragment-based handoff that never reaches the server logs.
- Mitigation: Keep TTLs short, invalidate tokens immediately after use, and
  scrub URLs from logs/analytics until the flow is redesigned.
- False positive notes: None. The code constructs and consumes the tokens via
  URL paths and query params directly.

### SEC-002: Doctors can issue patient-app registration codes for patients they are not assigned to

- Severity: High
- Location:
  - `backend/app/api/patient_app.py:62-76`
  - `backend/app/services/patient.py:140-188`
- Evidence:
  - `generate_registration_code()` only checks
    `current_user.role in (UserRole.admin, UserRole.doctor)` and then calls
    `patient_app_service.create_registration_code(...)`.
  - Other patient-facing routes enforce assignment via
    `patient_service.verify_doctor_patient_access(...)`.
- Impact: Any doctor account can mint a valid patient-app onboarding code for
  any patient record, even when that doctor is not assigned to the patient.
  That weakens access-control boundaries and can bootstrap unauthorized patient
  app enrollment if the attacker also knows or can socially engineer the phone
  verification details.
- Fix: Call `patient_service.verify_doctor_patient_access(...)` before
  generating the code, matching the pattern already used by patient read/update
  routes. Admins can remain globally authorized.
- Mitigation: Audit existing registration-code issuance for unassigned-doctor
  activity and invalidate unused codes if you suspect misuse.
- False positive notes: This is a direct policy inconsistency in the codebase,
  not just a missing defense-in-depth control.

### SEC-003: The frontend keeps access JWTs in script-readable state even though the backend already sets an `HttpOnly` auth cookie

- Severity: High
- Location:
  - `frontend/store/auth-store.ts:14-25`
  - `frontend/store/auth-store.ts:45-52`
  - `frontend/store/auth-store.ts:71-78`
  - `frontend/lib/api.ts:341-349`
  - `backend/app/api/auth.py:62-71`
  - `backend/app/api/auth.py:733-754`
- Evidence:
  - The Zustand store persists `token`, `role`, and `userId` in memory.
  - `rawFetch()` adds `Authorization: Bearer ${token}` whenever a token exists.
  - The backend also sets the same access token as an `HttpOnly` cookie during
    login and refresh.
- Impact: Any XSS in the dashboard can read and exfiltrate the Bearer token for
  replay from another device. The `HttpOnly` cookie already covers browser
  session continuity, so keeping the JWT in JavaScript expands the blast
  radius without adding meaningful security value.
- Fix: Move to a cookie-only session model for browser traffic. Keep the JWT
  server-managed in `HttpOnly` cookies, fetch user identity via `/auth/me`, and
  remove the client-side Bearer header path for web requests.
- Mitigation: Until the flow is simplified, prioritize CSP and any XSS
  reduction work because a single frontend injection becomes full session theft.
- False positive notes: The token is not persisted to `localStorage`, which is
  better than disk persistence, but it is still fully readable by any injected
  script in the page.

## Medium severity findings

### SEC-004: IP-based protections are not proxy-aware, so bans and rate limits can become inaccurate in production

- Severity: Medium
- Location:
  - `backend/app/core/request_utils.py:17-46`
  - `backend/app/core/limiter.py:20-39`
  - `backend/app/core/limiter.py:48-54`
  - `backend/entrypoint.sh:64-66`
- Evidence:
  - `get_client_ip()` honors `CF-Connecting-IP` and `X-Forwarded-For` when the
    direct peer is trusted.
  - `Limiter` keys and failed-login keys instead use `request.client.host` and
    `slowapi.util.get_remote_address(request)`.
  - The production entrypoint starts `uvicorn` without any visible proxy-header
    or forwarded-header handling.
- Impact: Behind a reverse proxy or CDN, multiple real users can collapse onto
  the same apparent source IP. That makes login throttling and IP bans either
  too aggressive (shared false positives) or too weak (attacker traffic not
  attributed to the real client).
- Fix: Standardize on one trusted-proxy-aware client-IP extractor for the rate
  limiter, failed-login tracking, and IP-ban middleware. Also ensure the ASGI
  deployment is explicitly configured for forwarded headers only from trusted
  proxies.
- Mitigation: Validate production behavior with end-to-end tests from behind
  the real ingress path before relying on rate-limit and IP-ban numbers.
- False positive notes: The exact failure mode depends on how the app is
  deployed, but the inconsistency is visible in code now.

### SEC-005: The patient join flow loads a privileged third-party SDK directly from `unpkg.com` without in-repo CSP or integrity controls

- Severity: Medium
- Location:
  - `frontend/app/patient/join/page.tsx:46-47`
  - `frontend/app/patient/join/page.tsx:277-320`
  - `frontend/next.config.ts:24-53`
- Evidence:
  - The page hardcodes
    `https://unpkg.com/@zegocloud/zego-uikit-prebuilt/zego-uikit-prebuilt.js`.
  - It injects the script dynamically with `document.createElement("script")`.
  - The Next.js config contains rewrites and image rules, but no visible
    security header or CSP configuration.
- Impact: That SDK runs with full page privileges on a sensitive page that
  handles meeting joins, camera, microphone, and patient presence. A supply
  chain compromise or malicious package replacement at the CDN layer would give
  an attacker code execution in that trust boundary.
- Fix: Prefer bundling the SDK from `node_modules` or self-hosting a pinned
  asset under your control. Add a restrictive CSP and avoid runtime script
  injection from public CDNs for privileged flows.
- Mitigation: If you must keep CDN loading temporarily, pin exact versions,
  reduce privileges on the page, and verify runtime headers at the edge.
- False positive notes: If CSP is injected only at the CDN or reverse proxy,
  it is not visible in this repo and still would not remove the third-party
  trust dependency itself.

## Low severity findings

### SEC-006: A repository script contains a hard-coded admin password

- Severity: Low
- Location:
  - `scripts/verify_audit_enhancements.py:7-9`
- Evidence:
  - The script defines `ADMIN_EMAIL = "admin@example.com"` and
    `ADMIN_PASSWORD = "password123"`.
- Impact: Even if this is only a local verification script, hard-coded
  credentials normalize unsafe practices and are easy to copy into production
  troubleshooting. They also create confusion about whether a default admin
  password exists.
- Fix: Read credentials from environment variables and fail fast when they are
  missing.
- Mitigation: Search the repo history for similar hard-coded credentials and
  remove them.
- False positive notes: This is less severe if the script is never used outside
  a disposable local environment, but it is still worth removing.

## Additional observations

These items are visible hardening gaps, but I did not score them as core
findings because they depend more heavily on runtime or deployment context.

- `backend/app/main.py:27` instantiates `FastAPI(...)` with default docs and
  OpenAPI routes, so `/docs`, `/redoc`, and `/openapi.json` appear to remain
  enabled unless blocked at the edge. For public production services, disable
  or protect them.
- `backend/app/main.py:27-123` shows no `TrustedHostMiddleware`. If the app is
  internet-facing behind multiple hostnames, add explicit host allowlisting or
  enforce it at the reverse proxy.
- `frontend/next.config.ts:24-53` shows no in-repo CSP, `frame-ancestors`, or
  other frontend security-header configuration. Verify whether these are set at
  Vercel, nginx, Cloud Run, or another edge layer.

## Recommended remediation order

Address the issues in this order:

1. Remove tokens from URLs and redesign reset/invite transport.
2. Add assignment checks to patient-app registration code issuance.
3. Stop exposing access JWTs to frontend JavaScript for browser sessions.
4. Normalize proxy-aware client IP handling across all security controls.
5. Replace CDN script injection on the patient join page with a pinned,
   first-party delivery model.
