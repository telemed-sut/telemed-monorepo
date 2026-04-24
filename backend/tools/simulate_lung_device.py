#!/usr/bin/env python3
"""Send signed lung-device requests to a local or deployed backend."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def _compact_json(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")


def _signature(secret: str, timestamp: str, device_id: str, body: bytes, nonce: str) -> tuple[str, str]:
    body_hash = hashlib.sha256(body).hexdigest()
    message = f"{timestamp}{device_id}{body_hash}{nonce}"
    digest = hmac.new(secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).hexdigest()
    return body_hash, digest


def _request_headers(secret: str, device_id: str, body: bytes) -> dict[str, str]:
    timestamp = str(int(time.time()))
    nonce = uuid.uuid4().hex
    body_hash, signature = _signature(secret, timestamp, device_id, body, nonce)
    return {
        "Content-Type": "application/json",
        "X-Device-Id": device_id,
        "X-Timestamp": timestamp,
        "X-Body-Hash": body_hash,
        "X-Nonce": nonce,
        "X-Signature": signature,
    }


def _post(base_url: str, path: str, secret: str, device_id: str, body: bytes) -> tuple[int, str]:
    url = f"{base_url.rstrip('/')}{path}"
    request = Request(
        url,
        data=body,
        headers=_request_headers(secret, device_id, body),
        method="POST",
    )
    try:
        with urlopen(request, timeout=10) as response:
            return response.status, response.read().decode("utf-8")
    except HTTPError as exc:
        return exc.code, exc.read().decode("utf-8")
    except URLError as exc:
        raise SystemExit(f"Request failed: {exc}") from exc


def _build_lung_payload(args: argparse.Namespace) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "device_id": args.device_id,
        "position": args.position,
        "blob_url": args.blob_url,
        "storage_key": args.storage_key,
        "mime_type": args.mime_type,
        "duration_seconds": args.duration_seconds,
        "sample_rate_hz": args.sample_rate_hz,
        "channel_count": args.channel_count,
        "wheeze_score": args.wheeze_score,
        "crackle_score": args.crackle_score,
        "analysis": {
            "simulated": True,
            "quality": args.quality,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
        "recorded_at": datetime.now(timezone.utc).isoformat(),
    }
    if args.session_id:
        payload["session_id"] = args.session_id
    if args.patient_id:
        payload["user_id"] = args.patient_id
    return {key: value for key, value in payload.items() if value is not None}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Simulate signed lung-device traffic.")
    parser.add_argument("--base-url", default=os.getenv("DEVICE_SIM_BASE_URL", "http://127.0.0.1:8000"))
    parser.add_argument("--device-id", default=os.getenv("DEVICE_ID", "lung-sim-01"))
    parser.add_argument("--device-secret", default=os.getenv("DEVICE_API_SECRET"))
    parser.add_argument("--session-id", default=os.getenv("DEVICE_SESSION_ID"))
    parser.add_argument("--patient-id", default=os.getenv("PATIENT_ID"))
    parser.add_argument("--mode", choices=("lung", "heartbeat", "both"), default="lung")
    parser.add_argument("--position", type=int, default=3)
    parser.add_argument("--blob-url", default="https://example.invalid/lung-sounds/simulated.wav")
    parser.add_argument("--storage-key", default="lung-sounds/simulated.wav")
    parser.add_argument("--mime-type", default="audio/wav")
    parser.add_argument("--duration-seconds", type=int, default=12)
    parser.add_argument("--sample-rate-hz", type=int, default=16000)
    parser.add_argument("--channel-count", type=int, default=1)
    parser.add_argument("--wheeze-score", type=int, default=12)
    parser.add_argument("--crackle-score", type=int, default=4)
    parser.add_argument("--quality", default="ok")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.device_secret:
        print("Set DEVICE_API_SECRET or pass --device-secret.", file=sys.stderr)
        return 2
    if args.mode in {"heartbeat", "both"} and not args.session_id:
        print("Heartbeat mode requires --session-id or DEVICE_SESSION_ID.", file=sys.stderr)
        return 2

    if args.mode in {"lung", "both"}:
        body = _compact_json(_build_lung_payload(args))
        status_code, response_body = _post(
            args.base_url,
            "/device/v1/lung-sounds",
            args.device_secret,
            args.device_id,
            body,
        )
        print(f"lung-sounds {status_code}: {response_body}")

    if args.mode in {"heartbeat", "both"}:
        status_code, response_body = _post(
            args.base_url,
            f"/device/v1/sessions/{args.session_id}/heartbeat",
            args.device_secret,
            args.device_id,
            b"",
        )
        print(f"heartbeat {status_code}: {response_body}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
