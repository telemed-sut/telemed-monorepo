#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_ENV_FILE="$ROOT_DIR/backend/.env"
TMP_ROOT="${TMPDIR:-/tmp}"
TUNNEL_LOG_FILE="$TMP_ROOT/telemed-cloudflared.log"
TUNNEL_PID_FILE="$TMP_ROOT/telemed-cloudflared.pid"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:3000}"

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

upsert_env_value() {
  local key="$1"
  local value="$2"
  local escaped_value
  escaped_value="$(printf "%s" "$value" | sed -e 's/[&|]/\\&/g')"

  if grep -q "^${key}=" "$BACKEND_ENV_FILE"; then
    sed -i '' "s|^${key}=.*|${key}=${escaped_value}|" "$BACKEND_ENV_FILE"
  else
    printf "\n%s=%s\n" "$key" "$value" >>"$BACKEND_ENV_FILE"
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
  grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG_FILE" 2>/dev/null | head -n 1 || true
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

main() {
  require_command cloudflared
  require_command docker
  require_command sed
  require_command grep

  if [[ ! -f "$BACKEND_ENV_FILE" ]]; then
    echo "Missing backend env file: $BACKEND_ENV_FILE" >&2
    exit 1
  fi

  echo "Starting backend containers (with backend rebuild)..."
  (
    cd "$ROOT_DIR"
    docker compose up -d --build db backend >/dev/null
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

  local lan_origin
  lan_origin="$(detect_lan_origin)"
  local cors_origins="http://localhost:3000,http://localhost:8080"
  if [[ -n "$lan_origin" ]]; then
    cors_origins="${cors_origins},${lan_origin}"
  fi
  cors_origins="${cors_origins},${tunnel_url}"

  echo "Updating backend/.env..."
  upsert_env_value "FRONTEND_BASE_URL" "http://localhost:3000"
  upsert_env_value "MEETING_PATIENT_JOIN_BASE_URL" "$tunnel_url"
  upsert_env_value "CORS_ORIGINS" "$cors_origins"

  echo "Restarting backend to apply env..."
  (
    cd "$ROOT_DIR"
    docker compose restart backend >/dev/null
  )

  cat <<EOF

Ready.
- Tunnel URL: $tunnel_url
- Cloudflared PID: $tunnel_pid
- Tunnel log: $TUNNEL_LOG_FILE

Use:
1) Doctor opens http://localhost:3000/meetings
2) Create/open call
3) Copy patient link from the page and send to patient

Stop tunnel later:
  kill \$(cat "$TUNNEL_PID_FILE")
EOF
}

main "$@"
