#!/usr/bin/env python3
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from urllib.parse import urlsplit


def _require_env(name: str) -> str:
    value = (os.getenv(name) or "").strip()
    if not value:
        print(f"Missing required environment variable: {name}", file=sys.stderr)
        sys.exit(1)
    return value


def _is_enabled(name: str, default: str = "true") -> bool:
    value = (os.getenv(name) or default).strip().lower()
    return value in {"1", "true", "yes", "on"}


def _request_json(url: str, method: str = "GET", body: dict | None = None, headers: dict | None = None) -> tuple[int, object]:
    timeout = float(os.getenv("SMOKE_TEST_TIMEOUT_SECONDS", "20"))
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)

    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")

    req = urllib.request.Request(url=url, method=method, data=data, headers=req_headers)
    try:
        # nosemgrep: dynamic-urllib-use-detected
        # URLs are normalized and scheme-validated before reaching this smoke test helper.
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8").strip()
            payload = json.loads(raw) if raw else {}
            return resp.status, payload
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8").strip()
        try:
            payload = json.loads(raw) if raw else {}
        except Exception:
            payload = {"raw": raw}
        return err.code, payload


def _assert(condition: bool, message: str) -> None:
    if not condition:
        print(message, file=sys.stderr)
        sys.exit(1)


def _normalize_base_url(url: str) -> str:
    normalized = url[:-1] if url.endswith("/") else url
    parsed = urlsplit(normalized)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError(f"Unsupported URL scheme for smoke test: {normalized}")
    return normalized


def _smoke_health(backend_base_url: str) -> None:
    status, payload = _request_json(f"{backend_base_url}/health")
    _assert(status == 200, f"Health check failed with status={status}, payload={payload}")
    _assert(isinstance(payload, dict) and payload.get("status") == "ok", f"Unexpected health payload: {payload}")
    print("health: ok")


def _smoke_frontend(frontend_base_url: str) -> None:
    timeout = float(os.getenv("SMOKE_TEST_TIMEOUT_SECONDS", "20"))
    req = urllib.request.Request(url=frontend_base_url, method="GET")
    try:
        # nosemgrep: dynamic-urllib-use-detected
        # Frontend base URL is normalized and validated before this smoke request runs.
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            _assert(resp.status < 500, f"Frontend returned status={resp.status}")
    except urllib.error.HTTPError as err:
        _assert(err.code < 500, f"Frontend returned status={err.code}")
    print("frontend: ok")


def _login(backend_base_url: str, email: str, password: str, otp_code: str | None) -> str:
    payload = {"email": email, "password": password}
    if otp_code:
        payload["otp_code"] = otp_code

    status, body = _request_json(f"{backend_base_url}/auth/login", method="POST", body=payload)
    _assert(status == 200, f"Login failed status={status}, payload={body}")
    _assert(isinstance(body, dict), f"Login response is not an object: {body}")
    token = body.get("access_token")
    _assert(isinstance(token, str) and token, f"Missing access_token in login response: {body}")
    print("login: ok")
    return token


def _create_patient(backend_base_url: str, token: str) -> None:
    unique = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    payload = {
        "first_name": f"Smoke{unique}",
        "last_name": "Test",
        "date_of_birth": "1990-01-01",
        "gender": "unknown",
    }
    headers = {"Authorization": f"Bearer {token}"}
    status, body = _request_json(f"{backend_base_url}/patients", method="POST", body=payload, headers=headers)
    _assert(status == 201, f"Create patient failed status={status}, payload={body}")
    _assert(isinstance(body, dict) and body.get("id"), f"Create patient response missing id: {body}")
    print("create_patient: ok")


def main() -> None:
    backend_base_url = _normalize_base_url(_require_env("BACKEND_BASE_URL"))
    frontend_base_url = _normalize_base_url(os.getenv("FRONTEND_BASE_URL", ""))
    email = _require_env("SMOKE_TEST_EMAIL")
    password = _require_env("SMOKE_TEST_PASSWORD")
    otp_code = (os.getenv("SMOKE_TEST_OTP_CODE") or "").strip() or None
    should_create_patient = _is_enabled("SMOKE_TEST_CREATE_PATIENT", default="true")

    started_at = time.time()
    _smoke_health(backend_base_url)
    if frontend_base_url:
        _smoke_frontend(frontend_base_url)

    token = _login(backend_base_url, email, password, otp_code)
    if should_create_patient:
        _create_patient(backend_base_url, token)
    else:
        print("create_patient: skipped")

    duration = round(time.time() - started_at, 2)
    print(f"smoke_test: passed ({duration}s)")


if __name__ == "__main__":
    main()
