# Lung sound device API contract

This contract defines the current backend-ready interface for lung sound
devices. It lets you test the hospital workflow before physical hardware is
available, and it gives a vendor a stable starting point for integration.

The backend treats the database session as the source of truth. A device can
send `session_id` explicitly, or the backend can resolve the active patient
from the current active session for `device_id`.

## Endpoint

Send lung sound metadata to the device ingest endpoint.

```http
POST /device/v1/lung-sounds
Content-Type: application/json
X-Device-Id: lung-ward-01
X-Timestamp: 1776800400
X-Body-Hash: sha256(raw_json_body)
X-Nonce: unique-per-request
X-Signature: hmac_sha256(secret, timestamp + device_id + body_hash + nonce)
```

The backend returns a minimal acknowledgement.

```json
{
  "status": "ok",
  "record_id": "7ad862dc-70b4-4fc3-b3f2-d0f8df2ebf23"
}
```

## Payload

Send this JSON body for a lung sound reading.

```json
{
  "session_id": "8c747afe-4dc2-45f8-9fa7-4b195f446846",
  "device_id": "lung-ward-01",
  "position": 3,
  "blob_url": "https://storage.example/lung-sounds/reading.wav",
  "storage_key": "lung-sounds/reading.wav",
  "mime_type": "audio/wav",
  "duration_seconds": 12,
  "sample_rate_hz": 16000,
  "channel_count": 1,
  "wheeze_score": 12,
  "crackle_score": 4,
  "analysis": {
    "quality": "ok",
    "model_version": "vendor-model-1"
  },
  "recorded_at": "2026-04-22T10:10:00Z"
}
```

Use these fields as follows:

- `session_id`: Optional but recommended. It must reference an active device
  exam session for the same `device_id`.
- `user_id`: Optional fallback. Use it only when the device cannot send
  `session_id`. The backend rejects mismatches with the active session.
- `device_id`: Required. It must match `X-Device-Id`.
- `position`: Required auscultation position. Current accepted range is `1`
  through `14`.
- `blob_url`: Optional absolute `http` or `https` URL to the uploaded audio.
- `storage_key`: Optional storage path for later signed read URL generation.
- `mime_type`: Optional audio MIME type such as `audio/wav`.
- `duration_seconds`: Optional audio duration.
- `sample_rate_hz`: Optional sample rate.
- `channel_count`: Optional channel count.
- `wheeze_score` and `crackle_score`: Optional integer scores from `0` to
  `100`.
- `analysis`: Optional vendor analysis object. Keep it small and structured.
- `recorded_at`: Optional device timestamp. If omitted, the backend uses the
  signed request timestamp.

## Heartbeat

Send heartbeat traffic while a session is active.

```http
POST /device/v1/sessions/{session_id}/heartbeat
X-Device-Id: lung-ward-01
X-Timestamp: 1776800400
X-Body-Hash: sha256(empty_body)
X-Nonce: unique-per-request
X-Signature: hmac_sha256(secret, timestamp + device_id + body_hash + nonce)
```

The heartbeat endpoint accepts an empty request body. It updates
`last_seen_at` for the active device exam session.

## Local simulator

Use the simulator while you don't have a physical device.

Run the backend, then seed a ready-to-use local demo flow:

```bash
cd backend
venv/bin/alembic upgrade head
python scripts/seed_device_demo_flow.py
```

The seed script creates or updates one local demo doctor, patient, registered
lung device, doctor-patient assignment, and active device exam session. It
prints the exact simulator command with the generated `DEVICE_SESSION_ID`.
The seed reads current database state directly and does not require an external
cache service.

You can also register a device and start a device session manually in
`/device-monitor`, then run:

```bash
cd backend
DEVICE_API_SECRET="device-secret" \
DEVICE_SESSION_ID="8c747afe-4dc2-45f8-9fa7-4b195f446846" \
python tools/simulate_lung_device.py \
  --base-url http://127.0.0.1:8000 \
  --device-id lung-ward-01 \
  --mode both
```

If the backend is configured to resolve by active session, omit
`DEVICE_SESSION_ID` for lung-sound ingest:

```bash
cd backend
DEVICE_API_SECRET="device-secret" \
python tools/simulate_lung_device.py \
  --base-url http://127.0.0.1:8000 \
  --device-id lung-ward-01 \
  --mode lung
```

## Integration checklist

Before a vendor device is accepted for pilot testing, verify these points:

- The device is registered in the backend device registry.
- The device secret matches the registered secret.
- The device sends `X-Body-Hash`, `X-Nonce`, and `X-Signature`.
- The device clock is synchronized to UTC.
- The device sends either `session_id` or relies on an active backend session.
- The backend rejects mismatched `device_id`, patient, or session values.
- The `/device-monitor` page shows the session as fresh after ingest.

## Next steps

Replace the generic `analysis` object with stricter fields only after the
vendor provides a final payload specification. Keep the current endpoint
backward-compatible while the hardware contract is still changing.
