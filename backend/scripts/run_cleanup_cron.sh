#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="$ROOT_DIR/logs/cron_cleanup.log"

cd "$ROOT_DIR"

if [ -n "${DATABASE_URL:-}" ] && [ -n "${JWT_SECRET:-}" ]; then
  venv/bin/python scripts/cleanup_audit_logs.py >>"$LOG_FILE" 2>&1
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
  exit 0
fi

echo "Missing backend runtime env. Inject env first or configure Infisical CLI." >>"$LOG_FILE"
exit 1
