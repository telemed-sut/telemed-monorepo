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

should_force_recreate() {
  if [[ ${#services[@]} -eq 0 ]]; then
    return 0
  fi

  if contains_service "backend" "${services[@]}"; then
    return 0
  fi

  if contains_service "frontend" "${services[@]}"; then
    return 0
  fi

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

inject_running_tunnels() {
  local tmp_root="${TMPDIR:-/tmp}"
  
  # Check web share-link tunnel
  if [[ -f "$tmp_root/telemed-cloudflared.pid" ]]; then
    local pid
    pid="$(cat "$tmp_root/telemed-cloudflared.pid" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      local tunnel_url
      tunnel_url="$(LC_ALL=C grep -aEo 'https://[a-z0-9-]+\.trycloudflare\.com' "$tmp_root/telemed-cloudflared.log" 2>/dev/null | head -n 1 || true)"
      if [[ -n "$tunnel_url" ]]; then
        export MEETING_PATIENT_JOIN_BASE_URL="${MEETING_PATIENT_JOIN_BASE_URL:-$tunnel_url}"
        
        # Append to CORS_ORIGINS
        local current_cors="${CORS_ORIGINS:-http://localhost:3000,http://127.0.0.1:3000,http://localhost:8080,http://127.0.0.1:8080}"
        if [[ "$current_cors" != *"$tunnel_url"* ]]; then
          export CORS_ORIGINS="$current_cors,$tunnel_url"
        fi
        
        echo "- Auto-injected running share-link tunnel: $tunnel_url"
      fi
    fi
  fi

  # Check mobile API tunnel
  if [[ -f "$tmp_root/telemed-mobile-api-cloudflared.pid" ]]; then
    local pid
    pid="$(cat "$tmp_root/telemed-mobile-api-cloudflared.pid" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      local tunnel_url
      tunnel_url="$(LC_ALL=C grep -aEo 'https://[a-z0-9-]+\.trycloudflare\.com' "$tmp_root/telemed-mobile-api-cloudflared.log" 2>/dev/null | head -n 1 || true)"
      if [[ -n "$tunnel_url" ]]; then
        local host="${tunnel_url#https://}"
        
        # Append to ALLOWED_HOSTS
        local current_hosts="${ALLOWED_HOSTS:-localhost,127.0.0.1,::1,backend,patient-backend,frontend,patient-frontend}"
        if [[ "$current_hosts" != *"$host"* ]]; then
          export ALLOWED_HOSTS="$current_hosts,$host"
        fi
        
        # Append to CORS_ORIGINS
        local current_cors="${CORS_ORIGINS:-http://localhost:3000,http://127.0.0.1:3000,http://localhost:8080,http://127.0.0.1:8080}"
        if [[ "$current_cors" != *"$tunnel_url"* ]]; then
          export CORS_ORIGINS="$current_cors,$tunnel_url"
        fi
        
        echo "- Auto-injected running mobile API tunnel host: $host"
      fi
    fi
  fi
}

main() {
  cd "$ROOT_DIR"
  load_default_runtime_env
  derive_local_db_env
  inject_running_tunnels
  ./scripts/check-compose-env.sh "$@"

  compose_args=(up --build)
  if should_force_recreate; then
    echo "Forcing recreate for app containers to avoid stale auto-restarted services."
    compose_args+=(--force-recreate)
  fi

  exec env COMPOSE_DISABLE_ENV_FILE=1 docker compose "${compose_args[@]}" "$@"
}

main "$@"
