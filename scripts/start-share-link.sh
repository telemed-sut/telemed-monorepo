#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="${TMPDIR:-/tmp}"
TUNNEL_LOG_FILE="$TMP_ROOT/telemed-cloudflared.log"
TUNNEL_PID_FILE="$TMP_ROOT/telemed-cloudflared.pid"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:3000}"
SYNC_INFISICAL="${SYNC_INFISICAL:-true}"
INFISICAL_ENV="${INFISICAL_ENV:-dev}"
INFISICAL_PATH="${INFISICAL_PATH:-/}"
INFISICAL_PROJECT_ID="${INFISICAL_PROJECT_ID:-}"
VERIFY_TUNNEL="${VERIFY_TUNNEL:-true}"

is_enabled() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

detect_lan_origin() {
  local ip=""
  ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
  if [[ -z "$ip" ]]; then
    ip="$(ipconfig getifaddr en1 2>/dev/null || true)"
  fi
  if [[ -n "$ip" ]]; then
    printf "http://%s:3000" "$ip"
  fi
}

extract_tunnel_url() {
  # cloudflared logs can contain NUL bytes; force text mode to avoid
  # grep returning "Binary file ... matches".
  LC_ALL=C grep -aEo 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG_FILE" 2>/dev/null | head -n 1 || true
}

is_valid_tunnel_url() {
  local value="$1"
  [[ "$value" =~ ^https://[a-z0-9-]+\.trycloudflare\.com$ ]]
}

stop_previous_tunnel_if_any() {
  if [[ -f "$TUNNEL_PID_FILE" ]]; then
    local old_pid
    old_pid="$(cat "$TUNNEL_PID_FILE" 2>/dev/null || true)"
    if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
      kill "$old_pid" 2>/dev/null || true
    fi
  fi
}

build_infisical_flags() {
  INFISICAL_FLAGS=(--env "$INFISICAL_ENV" --path "$INFISICAL_PATH")
  if [[ -n "$INFISICAL_PROJECT_ID" ]]; then
    INFISICAL_FLAGS+=(--projectId "$INFISICAL_PROJECT_ID")
  fi
}

upsert_infisical_value() {
  local key="$1"
  local value="$2"
  build_infisical_flags
  infisical secrets set "${key}=${value}" "${INFISICAL_FLAGS[@]}" >/dev/null
}

apply_backend_env_changes() {
  echo "Applying backend config..."

  if is_enabled "$SYNC_INFISICAL"; then
    require_command infisical
    echo "- Updating Infisical secrets..."
    upsert_infisical_value "FRONTEND_BASE_URL" "http://localhost:3000"
    upsert_infisical_value "MEETING_PATIENT_JOIN_BASE_URL" "$1"
    upsert_infisical_value "CORS_ORIGINS" "$2"
  else
    echo "- Using runtime-only compose overrides (Infisical sync disabled)"
  fi
}

restart_backend_to_apply_changes() {
  local meeting_patient_join_base_url="$1"
  local cors_origins="$2"
  echo "Restarting backend to apply env..."
  (
    cd "$ROOT_DIR"
    if is_enabled "$SYNC_INFISICAL"; then
      build_infisical_flags
      infisical run "${INFISICAL_FLAGS[@]}" -- env COMPOSE_DISABLE_ENV_FILE=1 docker compose up -d backend >/dev/null
    else
      FRONTEND_BASE_URL="http://localhost:3000" \
      MEETING_PATIENT_JOIN_BASE_URL="$meeting_patient_join_base_url" \
      CORS_ORIGINS="$cors_origins" \
      COMPOSE_DISABLE_ENV_FILE=1 docker compose up -d backend >/dev/null
    fi
  )
}

verify_tunnel_url() {
  local tunnel_url="$1"
  local check_url="${tunnel_url}/login"
  local status_code=""

  if ! is_enabled "$VERIFY_TUNNEL"; then
    return 0
  fi

  echo "Verifying tunnel URL is reachable..."
  local attempt=0
  while [ "$attempt" -lt 20 ]; do
    if [[ -f "$TUNNEL_PID_FILE" ]]; then
      local active_pid
      active_pid="$(cat "$TUNNEL_PID_FILE" 2>/dev/null || true)"
      if [[ -z "$active_pid" ]] || ! kill -0 "$active_pid" 2>/dev/null; then
        echo "Tunnel process is not running (pid file: $TUNNEL_PID_FILE)." >&2
        echo "Check log: $TUNNEL_LOG_FILE" >&2
        return 1
      fi
    fi

    status_code="$(
      curl -fsS -o /dev/null -w "%{http_code}" \
        --connect-timeout 5 \
        --max-time 10 \
        "$check_url" 2>/dev/null || true
    )"

    case "$status_code" in
      200|301|302|307|308)
        echo "- Tunnel reachable: $check_url (HTTP $status_code)"
        return 0
        ;;
    esac

    attempt=$((attempt + 1))
    sleep 1
  done

  echo "Tunnel URL is still not reachable after retries: $check_url" >&2
  echo "Last observed HTTP status: ${status_code:-none}" >&2
  echo "Check log: $TUNNEL_LOG_FILE" >&2
  return 1
}

verify_backend_tunnel_env() {
  local expected_url="$1"
  local actual_url

  actual_url="$(
    docker inspect patient-backend \
      --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
      | grep '^MEETING_PATIENT_JOIN_BASE_URL=' \
      | head -n 1 \
      | cut -d= -f2- || true
  )"

  if [[ "$actual_url" != "$expected_url" ]]; then
    echo "Backend runtime env mismatch for MEETING_PATIENT_JOIN_BASE_URL" >&2
    echo "- Expected: $expected_url" >&2
    echo "- Actual:   ${actual_url:-<empty>}" >&2
    return 1
  fi

  echo "- Backend env updated: MEETING_PATIENT_JOIN_BASE_URL"
}

main() {
  require_command cloudflared
  require_command docker
  require_command grep
  require_command curl

  echo "Starting backend containers (with backend rebuild)..."
  (
    cd "$ROOT_DIR"
    if is_enabled "$SYNC_INFISICAL"; then
      require_command infisical
      build_infisical_flags
      infisical run "${INFISICAL_FLAGS[@]}" -- env COMPOSE_DISABLE_ENV_FILE=1 docker compose up -d --build db backend >/dev/null
    else
      COMPOSE_DISABLE_ENV_FILE=1 docker compose up -d --build db backend >/dev/null
    fi
  )

  echo "Starting Cloudflare tunnel..."
  stop_previous_tunnel_if_any
  : >"$TUNNEL_LOG_FILE"
  cloudflared tunnel --url "$FRONTEND_URL" >"$TUNNEL_LOG_FILE" 2>&1 &
  local tunnel_pid=$!
  printf "%s" "$tunnel_pid" >"$TUNNEL_PID_FILE"

  local tunnel_url=""
  for _ in $(seq 1 30); do
    tunnel_url="$(extract_tunnel_url)"
    if [[ -n "$tunnel_url" ]]; then
      break
    fi
    sleep 1
  done

  if [[ -z "$tunnel_url" ]]; then
    echo "Unable to detect Cloudflare URL. Check log: $TUNNEL_LOG_FILE" >&2
    exit 1
  fi

  if ! is_valid_tunnel_url "$tunnel_url"; then
    echo "Detected invalid tunnel URL: $tunnel_url" >&2
    echo "Check log: $TUNNEL_LOG_FILE" >&2
    exit 1
  fi

  local lan_origin
  lan_origin="$(detect_lan_origin)"
  local cors_origins="http://localhost:3000,http://localhost:8080"
  if [[ -n "$lan_origin" ]]; then
    cors_origins="${cors_origins},${lan_origin}"
  fi
  cors_origins="${cors_origins},${tunnel_url}"

  apply_backend_env_changes "$tunnel_url" "$cors_origins"
  restart_backend_to_apply_changes "$tunnel_url" "$cors_origins"
  verify_backend_tunnel_env "$tunnel_url"
  verify_tunnel_url "$tunnel_url"

  cat <<EOF

Ready.
- Tunnel URL: $tunnel_url
- Cloudflared PID: $tunnel_pid
- Tunnel log: $TUNNEL_LOG_FILE
- Sync Infisical: $SYNC_INFISICAL

Use:
1) Doctor opens http://localhost:3000/meetings
2) Create/open call
3) Copy patient link from the page and send to patient

Stop tunnel later:
  kill \$(cat "$TUNNEL_PID_FILE")
EOF
}

main "$@"
