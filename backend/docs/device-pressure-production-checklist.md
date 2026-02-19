# Device Pressure API Production Checklist

This checklist is for deploying `/device/v1/pressure` (and legacy `/add_pressure`) in real hospital workflows.

## 1) Device authentication and signing

- Prefer per-device secrets via `DEVICE_API_SECRETS` (JSON map: `{"device_id":"secret"}`).
- If possible, set `DEVICE_API_REQUIRE_REGISTERED_DEVICE=true` so unknown device IDs are rejected.
- Set a fallback `DEVICE_API_SECRET` only for migration compatibility.
- Set `DEVICE_API_ALLOW_JWT_SECRET_FALLBACK=false` in production.
- Enable payload-bound signing: `DEVICE_API_REQUIRE_BODY_HASH_SIGNATURE=true`.
- Enable replay protection: `DEVICE_API_REQUIRE_NONCE=true`.
- Device/client signing (hardened mode, recommended):
  - `X-Body-Hash = sha256(raw_request_body_hex)`
  - `X-Nonce = unique_random_string_per_request`
  - `X-Signature = hmac_sha256(secret, timestamp + device_id + body_hash + nonce)`
- Keep timestamp skew small and controlled (default window: 5 minutes).

## 2) Transport and network controls

- Use HTTPS only (TLS end-to-end).
- Restrict source IPs at ingress/WAF to trusted device networks.
- Keep API behind an authenticated gateway where possible.
- Rate-limit is enabled in app, but enforce edge-level limits too.

## 3) Data integrity and validation

- Keep `sys_rate > dia_rate` validation enabled.
- Keep device/header consistency check enabled (`device_id` in header must match payload).
- Ensure each device sends accurate UTC timestamps.
- Prefer sending explicit `measured_at` from device clock.

## 4) Operational safety

- Monitor `device_error_logs` for repeated `Invalid signature`, `Invalid body hash`, and timestamp drift.
- Monitor replay indicators (`AUTH_FAILED:replay_nonce`) and unregistered device attempts.
- Alert on sudden spikes of device auth failures.
- Rotate device secrets on a schedule and during incident response.

### Quick troubleshooting runbook (for partner/device teams)

- UI: open `/device-monitor` and check **Recent Error Logs** table (`Code`, `Error`, `Suggestion`).
- API (admin): `GET /device/v1/errors?limit=50&hours=24`.
- SQL quick check:
  - `select device_id, error_message, occurred_at from device_error_logs order by occurred_at desc limit 50;`

Common `error_code` and what to tell the device team:

- `invalid_body_hash`:
  - Device must hash the exact raw JSON bytes that are actually sent, then set `X-Body-Hash`.
- `missing_nonce` / `replay_nonce`:
  - Send unique `X-Nonce` per request, never reuse.
- `timestamp_out_of_window`:
  - Sync device clock to UTC (NTP), keep skew within ~5 minutes.
- `device_id_mismatch`:
  - `X-Device-Id` must equal payload `device_id`.
- `unregistered_device`:
  - Register `device_id` in backend `DEVICE_API_SECRETS`.
- `validation_failed`:
  - Check payload types/ranges (`heart_rate`, `sys_rate`, `dia_rate`, `a[]`, `b[]`) and required fields.

## 5) Backward compatibility and migration

- `/add_pressure` is legacy; migrate devices to `/device/v1/pressure`.
- Rollout plan:
  1. Deploy with `DEVICE_API_REQUIRE_BODY_HASH_SIGNATURE=false` and `DEVICE_API_REQUIRE_NONCE=false`.
  2. Update all devices to include `X-Body-Hash`, `X-Nonce`, and signature over `timestamp + device_id + body_hash + nonce`.
  3. Enable `DEVICE_API_REQUIRE_BODY_HASH_SIGNATURE=true`.
  4. Enable `DEVICE_API_REQUIRE_NONCE=true`.
  5. Enable `DEVICE_API_REQUIRE_REGISTERED_DEVICE=true` after all devices are registered in `DEVICE_API_SECRETS`.
