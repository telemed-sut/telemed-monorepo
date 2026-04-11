#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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

derive_local_db_env() {
  if ! contains_service "db" "${services[@]}"; then
    return 0
  fi

  if [[ -n "${POSTGRES_USER:-}" && -n "${POSTGRES_PASSWORD:-}" && -n "${POSTGRES_DB:-}" ]]; then
    return 0
  fi

  if [[ -z "${DATABASE_URL:-}" ]]; then
    return 0
  fi

  local derived_env
  derived_env="$(
    DATABASE_URL="$DATABASE_URL" python3 - <<'PY'
import os
from urllib.parse import urlsplit

value = os.environ["DATABASE_URL"].strip()
parsed = urlsplit(value)
if not parsed.username or parsed.password is None:
    raise SystemExit(0)

database_name = (parsed.path or "").lstrip("/") or "patient_db"
host = (parsed.hostname or "").strip().lower()
if host != "db":
    raise SystemExit(0)

print("POSTGRES_USER=" + parsed.username)
print("POSTGRES_PASSWORD=" + parsed.password)
print("POSTGRES_DB=" + database_name)
PY
  )"

  if [[ -z "$derived_env" ]]; then
    return 0
  fi

  while IFS='=' read -r key value; do
    case "$key" in
      POSTGRES_USER)
        export POSTGRES_USER="${POSTGRES_USER:-$value}"
        ;;
      POSTGRES_PASSWORD)
        export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$value}"
        ;;
      POSTGRES_DB)
        export POSTGRES_DB="${POSTGRES_DB:-$value}"
        ;;
    esac
  done <<< "$derived_env"
}

main() {
  cd "$ROOT_DIR"
  derive_local_db_env
  ./scripts/check-compose-env.sh "$@"
  exec env COMPOSE_DISABLE_ENV_FILE=1 docker compose up --build "$@"
}

main "$@"
