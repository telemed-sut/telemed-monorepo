#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="$ROOT_DIR/logs/cron_cleanup.log"

cd "$ROOT_DIR"

load_env_file_if_present() {
  local env_file="$1"
  [[ -f "$env_file" ]] || return 0

  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -n "${line//[[:space:]]/}" ]] || continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" == *"="* ]] || continue

    key="${line%%=*}"
    value="${line#*=}"

    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"

    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue

    if [[ -z "${!key+x}" ]]; then
      export "$key=$value"
    fi
  done < "$env_file"
}

# Try loading env from root or current backend dir
load_env_file_if_present "$ROOT_DIR/../.env"
load_env_file_if_present "$ROOT_DIR/../.env.local"
load_env_file_if_present "$ROOT_DIR/.env"
load_env_file_if_present "$ROOT_DIR/.env.local"

if [ -n "${DATABASE_URL:-}" ] && [ -n "${JWT_SECRET:-}" ]; then
  venv/bin/python scripts/cleanup_audit_logs.py >>"$LOG_FILE" 2>&1
  venv/bin/python scripts/cleanup_sessions.py >>"$LOG_FILE" 2>&1
  exit 0
fi

if command -v infisical >/dev/null 2>&1; then
  infisical_args=()

  if [ -n "${INFISICAL_RUN_ARGS:-}" ]; then
    # shellcheck disable=SC2206
    infisical_args=(${INFISICAL_RUN_ARGS})
  else
    infisical_args=(--env "${INFISICAL_ENV:-dev}" --path "${INFISICAL_PATH:-/}")
    if [ -n "${INFISICAL_PROJECT_ID:-}" ]; then
      infisical_args+=(--projectId "${INFISICAL_PROJECT_ID}")
    fi
  fi

  infisical run "${infisical_args[@]}" -- venv/bin/python scripts/cleanup_audit_logs.py >>"$LOG_FILE" 2>&1
  infisical run "${infisical_args[@]}" -- venv/bin/python scripts/cleanup_sessions.py >>"$LOG_FILE" 2>&1
  exit 0
fi

echo "Missing backend runtime env. Inject env first or configure Infisical CLI." >>"$LOG_FILE"
exit 1
