import argparse
from collections import Counter
import hashlib
import hmac
import json
import secrets
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import urlsplit
from urllib import error as urllib_error
from urllib import request as urllib_request

STRICT_ONLY_SCENARIOS = {
    "invalid_body_hash",
    "missing_nonce",
    "missing_body_hash",
    "replay_nonce",
}

AVAILABLE_ERROR_SCENARIOS = (
    "invalid_body_hash",
    "missing_nonce",
    "missing_body_hash",
    "timestamp_out_of_window",
    "device_id_mismatch",
    "validation_failed",
    "unknown_patient",
    "invalid_signature",
    "replay_nonce",
)

DEFAULT_ERROR_SCENARIOS = (
    "invalid_body_hash",
    "missing_nonce",
    "timestamp_out_of_window",
    "validation_failed",
    "unknown_patient",
    "device_id_mismatch",
)
RNG = secrets.SystemRandom()


def _build_payload(patient_id: str, device_id: str, wave_points: int) -> dict:
    heart_rate = RNG.randint(62, 98)
    dia_rate = RNG.randint(68, 92)
    sys_rate = RNG.randint(max(dia_rate + 8, 105), 145)

    wave_a = [RNG.randint(0, 1024) for _ in range(wave_points)]
    wave_b = [RNG.randint(0, 1024) for _ in range(wave_points)]

    return {
        "user_id": patient_id,
        "device_id": device_id,
        "heart_rate": heart_rate,
        "sys_rate": sys_rate,
        "dia_rate": dia_rate,
        "a": wave_a,
        "b": wave_b,
        "measured_at": datetime.now(timezone.utc).isoformat(),
    }


def _compute_signature(
    *,
    secret_key: str,
    timestamp: str,
    device_id: str,
    body_hash: str | None = None,
    nonce: str | None = None,
) -> str:
    message = f"{timestamp}{device_id}"
    if body_hash:
        message += body_hash
    if nonce:
        message += nonce
    return hmac.new(
        secret_key.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _sign_headers(
    *,
    device_id: str,
    secret_key: str,
    raw_body: str,
    strict_signature: bool,
) -> dict[str, str]:
    timestamp = str(int(time.time()))
    headers = {
        "Content-Type": "application/json",
        "X-Device-Id": device_id,
        "X-Timestamp": timestamp,
    }

    body_hash = None
    nonce = None
    if strict_signature:
        body_hash = hashlib.sha256(raw_body.encode("utf-8")).hexdigest()
        nonce = secrets.token_hex(16)
        headers["X-Body-Hash"] = body_hash
        headers["X-Nonce"] = nonce

    signature = _compute_signature(
        secret_key=secret_key,
        timestamp=timestamp,
        device_id=device_id,
        body_hash=body_hash if strict_signature else None,
        nonce=nonce if strict_signature else None,
    )
    headers["X-Signature"] = signature
    return headers


def _resign_headers(
    headers: dict[str, str],
    *,
    secret_key: str,
    strict_signature: bool,
) -> None:
    timestamp = headers["X-Timestamp"]
    device_id = headers["X-Device-Id"]
    body_hash = headers.get("X-Body-Hash") if strict_signature else None
    nonce = headers.get("X-Nonce") if strict_signature else None
    headers["X-Signature"] = _compute_signature(
        secret_key=secret_key,
        timestamp=timestamp,
        device_id=device_id,
        body_hash=body_hash,
        nonce=nonce,
    )


def _parse_scenarios(raw: str) -> list[str]:
    if not raw.strip():
        return list(DEFAULT_ERROR_SCENARIOS)

    scenarios = [s.strip() for s in raw.split(",") if s.strip()]
    invalid = [s for s in scenarios if s not in AVAILABLE_ERROR_SCENARIOS]
    if invalid:
        raise ValueError(
            f"Unknown error scenario(s): {', '.join(invalid)}. "
            f"Available: {', '.join(AVAILABLE_ERROR_SCENARIOS)}"
        )
    if not scenarios:
        raise ValueError("No valid error scenarios provided.")
    return scenarios


def _choose_error_scenario(
    sent_index: int,
    *,
    alternate_error: bool,
    error_rate: float,
    scenarios: list[str],
) -> str | None:
    inject_error = False
    if alternate_error:
        # alternate mode: 1st success, 2nd error, 3rd success, ...
        inject_error = sent_index % 2 == 0
    elif error_rate > 0:
        inject_error = RNG.random() < error_rate

    if not inject_error:
        return None
    return RNG.choice(scenarios)


def _request_blueprint(
    *,
    patient_id: str,
    device_id: str,
    secret_key: str,
    strict_signature: bool,
    wave_points: int,
    error_scenario: str | None,
    replay_nonce: str | None,
) -> tuple[str, dict[str, str], str | None]:
    payload = _build_payload(patient_id, device_id, wave_points)

    if error_scenario == "validation_failed":
        payload["sys_rate"] = max(30, int(payload["dia_rate"]) - 1)
    elif error_scenario == "unknown_patient":
        payload["user_id"] = str(uuid.uuid4())
    elif error_scenario == "device_id_mismatch":
        payload["device_id"] = f"{device_id}_payload"

    raw_body = json.dumps(payload, separators=(",", ":"), ensure_ascii=True)
    headers = _sign_headers(
        device_id=device_id,
        secret_key=secret_key,
        raw_body=raw_body,
        strict_signature=strict_signature,
    )

    active_scenario = error_scenario
    if error_scenario:
        if error_scenario in STRICT_ONLY_SCENARIOS and not strict_signature:
            active_scenario = "invalid_signature"

        if active_scenario == "invalid_body_hash":
            headers["X-Body-Hash"] = hashlib.sha256(b"tampered-body").hexdigest()
            _resign_headers(headers, secret_key=secret_key, strict_signature=strict_signature)
        elif active_scenario == "missing_nonce":
            headers.pop("X-Nonce", None)
        elif active_scenario == "missing_body_hash":
            headers.pop("X-Body-Hash", None)
        elif active_scenario == "timestamp_out_of_window":
            headers["X-Timestamp"] = str(int(time.time()) - 3600)
            _resign_headers(headers, secret_key=secret_key, strict_signature=strict_signature)
        elif active_scenario == "invalid_signature":
            headers["X-Signature"] = "0" * 64
        elif active_scenario == "replay_nonce":
            if replay_nonce:
                headers["X-Nonce"] = replay_nonce
                _resign_headers(headers, secret_key=secret_key, strict_signature=strict_signature)
            else:
                active_scenario = "invalid_signature"
                headers["X-Signature"] = "0" * 64

    return raw_body, headers, active_scenario


def _send_once(
    *,
    base_url: str,
    endpoint: str,
    raw_body: str,
    headers: dict[str, str],
    timeout_seconds: float,
) -> tuple[int, float, str]:
    request_url = f"{base_url.rstrip('/')}/{endpoint.lstrip('/')}"
    parsed = urlsplit(request_url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("request URL must use http or https")
    start = time.perf_counter()
    req = urllib_request.Request(
        request_url,
        data=raw_body.encode("utf-8"),
        headers=headers,
        method="POST",
    )

    try:
        # nosemgrep: dynamic-urllib-use-detected
        # Device simulator validates request_url before use and only targets operator-provided endpoints.
        with urllib_request.urlopen(req, timeout=timeout_seconds) as response:
            response_body = response.read().decode("utf-8", errors="replace")
            status_code = response.getcode()
    except urllib_error.HTTPError as e:
        status_code = e.code
        response_body = e.read().decode("utf-8", errors="replace")
    except urllib_error.URLError as e:
        status_code = 0
        response_body = f"network_error: {e.reason}"

    latency_ms = (time.perf_counter() - start) * 1000
    return status_code, latency_ms, response_body


def _preview_response(text: str) -> str:
    normalized = text.replace("\n", " ").strip()
    if not normalized:
        return "-"
    try:
        parsed = json.loads(normalized)
        if isinstance(parsed, dict) and "detail" in parsed:
            return str(parsed["detail"])[:220]
    except json.JSONDecodeError:
        pass
    return normalized[:220]


def main():
    parser = argparse.ArgumentParser(
        description="Simulate a real BP device sending signed data to API."
    )
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--endpoint", default="/device/v1/pressure")
    parser.add_argument("--patient-id", required=True, help="UUID of patient (user_id in payload)")
    parser.add_argument("--device-id", required=True)
    parser.add_argument("--secret-key", required=True, help="Per-device secret from backend config")
    parser.add_argument(
        "--legacy-signature",
        action="store_true",
        help="Use legacy signature (timestamp+device_id only)",
    )
    parser.add_argument(
        "--alternate-error",
        action="store_true",
        help="Alternate requests: success, error, success, error, ...",
    )
    parser.add_argument(
        "--error-rate",
        type=float,
        default=0.0,
        help="Inject random errors with this probability [0.0-1.0]. Ignored when --alternate-error is used.",
    )
    parser.add_argument(
        "--error-scenarios",
        default=",".join(DEFAULT_ERROR_SCENARIOS),
        help=(
            "Comma-separated scenarios. Available: "
            + ",".join(AVAILABLE_ERROR_SCENARIOS)
        ),
    )
    parser.add_argument("--interval", type=float, default=1.0, help="Seconds between requests")
    parser.add_argument("--count", type=int, default=0, help="0 means run forever")
    parser.add_argument("--wave-points", type=int, default=50)
    parser.add_argument("--timeout", type=float, default=10.0)
    args = parser.parse_args()

    if not 0.0 <= args.error_rate <= 1.0:
        raise ValueError("--error-rate must be between 0.0 and 1.0")

    scenarios = _parse_scenarios(args.error_scenarios)
    strict_signature = not args.legacy_signature
    target_desc = f"{args.base_url.rstrip('/')}/{args.endpoint.lstrip('/')}"
    print(f"Target: {target_desc}")
    print(
        f"Mode: {'strict(body_hash+nonce)' if strict_signature else 'legacy(timestamp+device_id)'} | "
        f"interval={args.interval}s | count={'infinite' if args.count == 0 else args.count}"
    )
    if args.alternate_error:
        print(f"Error injection: alternate mode using scenarios={','.join(scenarios)}")
    elif args.error_rate > 0:
        print(
            f"Error injection: random rate={args.error_rate:.2f} "
            f"scenarios={','.join(scenarios)}"
        )
    else:
        print("Error injection: disabled")

    sent = 0
    ok = 0
    failed = 0
    status_counter: Counter[int] = Counter()
    scenario_counter: Counter[str] = Counter()
    last_success_nonce: str | None = None

    try:
        while True:
            sent += 1
            error_scenario = _choose_error_scenario(
                sent,
                alternate_error=args.alternate_error,
                error_rate=args.error_rate,
                scenarios=scenarios,
            )
            raw_body, headers, active_scenario = _request_blueprint(
                patient_id=args.patient_id,
                device_id=args.device_id,
                secret_key=args.secret_key,
                strict_signature=strict_signature,
                wave_points=args.wave_points,
                error_scenario=error_scenario,
                replay_nonce=last_success_nonce,
            )
            status_code, latency_ms, response_text = _send_once(
                base_url=args.base_url,
                endpoint=args.endpoint,
                raw_body=raw_body,
                headers=headers,
                timeout_seconds=args.timeout,
            )
            status_counter[status_code] += 1

            if 200 <= status_code < 300:
                ok += 1
                last_success_nonce = headers.get("X-Nonce", last_success_nonce)
                label = active_scenario or "success"
                print(
                    f"[{sent}] case={label} status={status_code} latency={latency_ms:.1f}ms"
                )
            else:
                failed += 1
                label = active_scenario or "unexpected_error"
                scenario_counter[label] += 1
                preview = _preview_response(response_text)
                print(
                    f"[{sent}] case={label} status={status_code} latency={latency_ms:.1f}ms "
                    f"detail={preview}"
                )

            if args.count > 0 and sent >= args.count:
                break

            time.sleep(max(args.interval, 0.0))
    except KeyboardInterrupt:
        print("\nStopped by user.")

    print(
        f"Summary: sent={sent} ok={ok} failed={failed} "
        f"success_rate={(ok / sent * 100 if sent else 0):.2f}%"
    )
    print("Status counts:", ", ".join(f"{k}:{v}" for k, v in sorted(status_counter.items())))
    if scenario_counter:
        print("Injected failure counts:", ", ".join(f"{k}:{v}" for k, v in sorted(scenario_counter.items())))


if __name__ == "__main__":
    main()
