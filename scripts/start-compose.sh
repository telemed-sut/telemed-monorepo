#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
services=("$@")
REPO_ENV_LOADED_KEYS="|"

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

    if [[ -n "${!key+x}" && "$REPO_ENV_LOADED_KEYS" != *"|$key|"* ]]; then
      continue
    fi

    export "$key=$value"
    REPO_ENV_LOADED_KEYS="${REPO_ENV_LOADED_KEYS}${key}|"
  done < "$env_file"
}

load_default_runtime_env() {
  load_env_file_if_present "$ROOT_DIR/.env"
  load_env_file_if_present "$ROOT_DIR/.env.local"
  load_env_file_if_present "$ROOT_DIR/backend/.env.local"
  load_env_file_if_present "$ROOT_DIR/frontend/.env.local"
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
from urllib.parse import urlsplit, urlunsplit

value = os.environ["DATABASE_URL"].strip()
parsed = urlsplit(value)
if not parsed.username or parsed.password is None:
    raise SystemExit(0)

database_name = (parsed.path or "").lstrip("/") or "patient_db"
host = (parsed.hostname or "").strip().lower()
if host not in {"localhost", "127.0.0.1", "db"}:
    raise SystemExit(0)

print("POSTGRES_USER=" + parsed.username)
print("POSTGRES_PASSWORD=" + parsed.password)
print("POSTGRES_DB=" + database_name)
container_netloc = f"{parsed.username}:{parsed.password}@db:{parsed.port or 5432}"
container_database_url = urlunsplit(
    (parsed.scheme, container_netloc, parsed.path or f"/{database_name}", parsed.query, parsed.fragment)
)
print("DOCKER_DATABASE_URL=" + container_database_url)
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
      DOCKER_DATABASE_URL)
        export DOCKER_DATABASE_URL="${DOCKER_DATABASE_URL:-$value}"
        ;;
    esac
  done <<< "$derived_env"
}

main() {
  cd "$ROOT_DIR"
  load_default_runtime_env
  derive_local_db_env
  ./scripts/check-compose-env.sh "$@"
  exec env COMPOSE_DISABLE_ENV_FILE=1 docker compose up --build "$@"
}

main "$@"
