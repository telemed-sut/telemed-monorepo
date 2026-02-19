# Hospital Device Monitor Roadmap

This roadmap focuses on making `/device/v1/pressure` and `/device-monitor` reliable for real clinical use.

## Phase 1: Security Baseline (Done in this sprint)

- Harden device authentication:
  - Body-bound signatures (`X-Body-Hash`)
  - Optional nonce replay protection (`X-Nonce`)
  - Optional per-device secrets (`DEVICE_API_SECRETS`)
  - Optional registered-device enforcement (`DEVICE_API_REQUIRE_REGISTERED_DEVICE`)
- Generic auth error responses returned to clients (`Invalid signature`).
- Legacy endpoint `/add_pressure` remains available with deprecation headers.
- Added production config switches in `.env`/compose docs.

## Phase 2: Clinical Data Reliability

- Add device clock drift dashboard (distribution of timestamp skew by device).
- Add data quality flags for implausible values:
  - Heart rate, systolic/diastolic outlier bands
  - Missing waveform quality rules
- Add ingestion idempotency dashboard (duplicates, replay blocks, rejects).
- Add configurable per-device sampling expectations (expected upload cadence).

## Phase 3: Monitoring UX for Doctors

- Provide a clinician-focused alert queue:
  - Unacknowledged critical devices
  - Recently recovered devices
  - Per-patient trend summary widgets
- Add acknowledgement workflow:
  - acknowledge reason
  - assignee
  - timestamps + audit trail
- Add triage filters:
  - ward/department
  - device model
  - patient risk bucket

## Phase 4: Operational Excellence

- Move real-time monitor to push model (SSE/WebSocket) when concurrency increases.
- Add SLO monitoring:
  - Ingestion success rate
  - p95/p99 latency for pressure ingestion
  - UI data freshness lag
- Add on-call alert rules:
  - auth failure spikes
  - replay-nonce spikes
  - ingestion outage by region/ward
- Run disaster recovery drill (restore + reindex + replay plan).

## Target KPIs

- `/device/v1/pressure` p95 latency: < 300 ms
- Device monitor refresh lag: <= 1s for error stream
- Successful ingestion rate: >= 99.9%
- Auth/replay false positives: < 0.1%
- Mean time to detect ingestion outage: < 2 minutes

## Production Go-Live Checklist (Doctor-facing)

- Security toggles verified in production:
  - `DEVICE_API_ALLOW_JWT_SECRET_FALLBACK=false`
  - `DEVICE_API_REQUIRE_BODY_HASH_SIGNATURE=true`
  - `DEVICE_API_REQUIRE_NONCE=true`
  - `DEVICE_API_REQUIRE_REGISTERED_DEVICE=true`
- Device registration list reviewed by clinical engineering.
- Alert ownership and on-call routing confirmed.
- Runbook tested with one simulated outage and one replay attack simulation.
