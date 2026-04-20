#!/usr/bin/env bash
set -euo pipefail

services=("$@")

contains_service() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    if [[ "$item" == "$needle" ]]; then
      return 0
    fi
  done
  return 1
}

is_truthy() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

print_missing_block() {
  local heading="$1"
  shift

  echo "$heading" >&2
  local item
  for item in "$@"; do
    echo "  - $item" >&2
  done
  echo >&2
}

collect_backend_env_issues() {
  python3 - <<'PY'
import json
import os
from urllib.parse import urlsplit


def add_issue(kind: str, message: str) -> None:
    print(f"{kind}:{message}")


database_url = (os.environ.get("DATABASE_URL") or "").strip()
jwt_secret = (os.environ.get("JWT_SECRET") or "").strip()
device_api_secret = (os.environ.get("DEVICE_API_SECRET") or "").strip()
device_api_secrets = (os.environ.get("DEVICE_API_SECRETS") or "").strip()
meeting_signing_secret = (os.environ.get("MEETING_SIGNING_SECRET") or "").strip()
redis_url = (os.environ.get("REDIS_URL") or "").strip()
azure_blob_storage_connection_string = (
    os.environ.get("AZURE_BLOB_STORAGE_CONNECTION_STRING") or ""
).strip()
azure_blob_storage_container = (
    os.environ.get("AZURE_BLOB_STORAGE_CONTAINER") or ""
).strip()
app_env = (os.environ.get("APP_ENV") or "development").strip().lower()

if not database_url:
    add_issue("missing", "DATABASE_URL")
else:
    lowered_database_url = database_url.lower()
    if "replace_with" in lowered_database_url:
        add_issue("invalid", "DATABASE_URL still contains placeholder text like 'replace_with'.")
    if "user:password@" in lowered_database_url:
        add_issue("invalid", "DATABASE_URL must not use default credentials 'user:password@'.")
    try:
        parsed = urlsplit(database_url)
    except Exception as exc:  # pragma: no cover - defensive shell helper
        add_issue("invalid", f"DATABASE_URL could not be parsed: {exc}")
    else:
        if not parsed.scheme or not parsed.hostname or not parsed.path.lstrip("/"):
            add_issue("invalid", "DATABASE_URL must include scheme, host, and database name.")

if not jwt_secret:
    add_issue("missing", "JWT_SECRET")
elif len(jwt_secret) < 32:
    add_issue("invalid", "JWT_SECRET must be at least 32 characters long.")

if not device_api_secret and not device_api_secrets and os.environ.get("DEVICE_API_REQUIRE_REGISTERED_DEVICE", "").strip().lower() not in {"1", "true", "yes", "on"}:
    add_issue("missing", "DEVICE_API_SECRET or DEVICE_API_SECRETS")

if device_api_secret:
    if "replace_with" in device_api_secret.lower():
        add_issue("invalid", "DEVICE_API_SECRET still contains placeholder text like 'replace_with'.")
    elif len(device_api_secret) < 32:
        add_issue("invalid", "DEVICE_API_SECRET must be at least 32 characters long.")

if device_api_secrets:
    entries = None
    try:
        parsed_json = json.loads(device_api_secrets)
    except json.JSONDecodeError:
        parsed_json = None
    if isinstance(parsed_json, dict):
        entries = parsed_json.items()
    elif "=" in device_api_secrets:
        entries = []
        for chunk in device_api_secrets.split(","):
            device_id, separator, secret = chunk.partition("=")
            if separator:
                entries.append((device_id.strip(), secret.strip()))
    if entries is None:
        add_issue(
            "invalid",
            "DEVICE_API_SECRETS must be valid JSON object or comma-separated 'device=secret' pairs.",
        )
    else:
        for device_id, secret in entries:
            if not device_id:
                add_issue("invalid", "DEVICE_API_SECRETS contains an empty device_id.")
                continue
            if not secret:
                add_issue("invalid", f"DEVICE_API_SECRETS[{device_id}] must not be empty.")
                continue
            if "replace_with" in secret.lower():
                add_issue(
                    "invalid",
                    f"DEVICE_API_SECRETS[{device_id}] still contains placeholder text like 'replace_with'.",
                )
                continue
            if len(secret) < 32:
                add_issue(
                    "invalid",
                    f"DEVICE_API_SECRETS[{device_id}] must be at least 32 characters long.",
                )

if meeting_signing_secret:
    if "replace_with" in meeting_signing_secret.lower():
        add_issue("invalid", "MEETING_SIGNING_SECRET still contains placeholder text like 'replace_with'.")
    elif len(meeting_signing_secret) < 32:
        add_issue("invalid", "MEETING_SIGNING_SECRET must be at least 32 characters long.")
elif app_env == "production":
    add_issue("missing", "MEETING_SIGNING_SECRET")
else:
    add_issue(
        "warning",
        "MEETING_SIGNING_SECRET is not set. Local backend can still run, but meeting invite signing flows will stay disabled.",
    )

if redis_url:
    if "replace_with" in redis_url.lower():
        add_issue("invalid", "REDIS_URL still contains placeholder text like 'replace_with'.")
elif app_env == "production":
    add_issue("missing", "REDIS_URL")
else:
    add_issue(
        "warning",
        "REDIS_URL is not set. Local backend can still run, but production-grade rate limiting and shared transient state are unavailable.",
    )

if not azure_blob_storage_connection_string:
    add_issue("missing", "AZURE_BLOB_STORAGE_CONNECTION_STRING")
elif "replace_with" in azure_blob_storage_connection_string.lower():
    add_issue(
        "invalid",
        "AZURE_BLOB_STORAGE_CONNECTION_STRING still contains placeholder text like 'replace_with'.",
    )

if not azure_blob_storage_container:
    add_issue("missing", "AZURE_BLOB_STORAGE_CONTAINER")
elif "replace_with" in azure_blob_storage_container.lower():
    add_issue(
        "invalid",
        "AZURE_BLOB_STORAGE_CONTAINER still contains placeholder text like 'replace_with'.",
    )
PY
}

check_backend_env() {
  local missing=()
  local invalid=()
  local warnings=()
  local issue_type
  local issue_message

  while IFS=':' read -r issue_type issue_message; do
    [[ -n "${issue_type:-}" ]] || continue
    case "$issue_type" in
      missing)
        missing+=("$issue_message")
        ;;
      invalid)
        invalid+=("$issue_message")
        ;;
      warning)
        warnings+=("$issue_message")
        ;;
    esac
  done < <(collect_backend_env_issues)

  if ((${#missing[@]} > 0)); then
    print_missing_block "Backend startup is missing required runtime configuration:" "${missing[@]}"
  fi

  if ((${#invalid[@]} > 0)); then
    print_missing_block "Backend startup has invalid runtime configuration:" "${invalid[@]}"
  fi

  if ((${#missing[@]} > 0 || ${#invalid[@]} > 0)); then
    echo "This repo expects Docker Compose runtime secrets to come from Infisical or exported shell variables." >&2
    echo "Add the missing keys to your Infisical environment, or export them before running ./scripts/dev-backend.sh." >&2
    echo >&2
    echo "Heart-sound uploads require AZURE_BLOB_STORAGE_CONNECTION_STRING and AZURE_BLOB_STORAGE_CONTAINER at startup." >&2
    echo >&2
    echo "Tip: for device ingest config, you can provide either DEVICE_API_SECRET, DEVICE_API_SECRETS, or set DEVICE_API_REQUIRE_REGISTERED_DEVICE=true intentionally." >&2
    exit 1
  fi

  if ((${#warnings[@]} > 0)); then
    print_missing_block "Backend runtime warnings:" "${warnings[@]}"
  fi
}

check_identity_env() {
  local missing=()

  [[ -n "${AUTHENTIK_POSTGRES_PASSWORD:-}" ]] || missing+=("AUTHENTIK_POSTGRES_PASSWORD")
  [[ -n "${AUTHENTIK_REDIS_PASSWORD:-}" ]] || missing+=("AUTHENTIK_REDIS_PASSWORD")
  [[ -n "${AUTHENTIK_SECRET_KEY:-}" ]] || missing+=("AUTHENTIK_SECRET_KEY")

  if ((${#missing[@]} > 0)); then
    echo "Identity profile is missing required runtime configuration:" >&2
    local item
    for item in "${missing[@]}"; do
      echo "  - $item" >&2
    done
    echo >&2
    echo "Set these keys in Infisical before running with COMPOSE_PROFILES=identity." >&2
    exit 1
  fi
}

main() {
  if contains_service "backend" "${services[@]}"; then
    check_backend_env
  fi

  if [[ "${COMPOSE_PROFILES:-}" == *identity* ]]; then
    check_identity_env
  fi
}

main
