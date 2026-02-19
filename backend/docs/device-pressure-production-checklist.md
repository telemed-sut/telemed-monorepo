# Device Pressure API Production Checklist

This checklist is for deploying `/device/v1/pressure` (and legacy `/add_pressure`) in real hospital workflows.

## 1) Device authentication and signing

- Set a dedicated `DEVICE_API_SECRET` (minimum 32 chars, random).
- Set `DEVICE_API_ALLOW_JWT_SECRET_FALLBACK=false` in production.
- Enable payload-bound signing: `DEVICE_API_REQUIRE_BODY_HASH_SIGNATURE=true`.
- Device/client signing (hardened mode):
  - `X-Body-Hash = sha256(raw_request_body_hex)`
  - `X-Signature = hmac_sha256(secret, timestamp + device_id + body_hash)`

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
- Alert on sudden spikes of device auth failures.
- Rotate `DEVICE_API_SECRET` with a planned cutover window.

## 5) Backward compatibility and migration

- `/add_pressure` is legacy; migrate devices to `/device/v1/pressure`.
- Rollout plan:
  1. Deploy with `DEVICE_API_REQUIRE_BODY_HASH_SIGNATURE=false` and update all devices to include `X-Body-Hash`.
  2. After all devices are updated, switch to `true`.

