#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="${TMPDIR:-/tmp}"
TUNNEL_LOG_FILE="$TMP_ROOT/telemed-mobile-api-cloudflared.log"
TUNNEL_PID_FILE="$TMP_ROOT/telemed-mobile-api-cloudflared.pid"
BACKEND_URL="${BACKEND_URL:-http://localhost:8000}"
CONFIG_FILE="${CONFIG_FILE:-$ROOT_DIR/mobile/patient_flutter_app/config/dart_defines.local.json}"
CONFIG_TEMPLATE="${CONFIG_TEMPLATE:-$ROOT_DIR/mobile/patient_flutter_app/config/dart_defines.example.json}"
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

stop_previous_tunnel_if_any() {
  if [[ -f "$TUNNEL_PID_FILE" ]]; then
    local old_pid
    old_pid="$(cat "$TUNNEL_PID_FILE" 2>/dev/null || true)"
    if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
      kill "$old_pid" 2>/dev/null || true
    fi
  fi
}

extract_tunnel_url() {
  LC_ALL=C grep -aEo 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG_FILE" 2>/dev/null | head -n 1 || true
}

is_valid_tunnel_url() {
  local value="$1"
  [[ "$value" =~ ^https://[a-z0-9-]+\.trycloudflare\.com$ ]]
}

verify_tunnel_health() {
  local tunnel_url="$1"
  local health_url="${tunnel_url}/health"
  local status_code=""

  if ! is_enabled "$VERIFY_TUNNEL"; then
    return 0
  fi

  echo "Verifying backend tunnel health..."
  for _ in $(seq 1 60); do
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
        "$health_url" 2>/dev/null || true
    )"

    if [[ "$status_code" == "200" ]]; then
      echo "- Tunnel healthy: $health_url"
      return 0
    fi

    sleep 1
  done

  echo "Warning: backend tunnel health check timed out: $health_url" >&2
  echo "Last observed HTTP status: ${status_code:-none}" >&2
  echo "Continuing because tunnel URL was detected and process is alive." >&2
  return 0
}

build_infisical_flags() {
  INFISICAL_FLAGS=(--env "$INFISICAL_ENV" --path "$INFISICAL_PATH")
  if [[ -n "$INFISICAL_PROJECT_ID" ]]; then
    INFISICAL_FLAGS+=(--projectId "$INFISICAL_PROJECT_ID")
  fi
}

ensure_config_file() {
  if [[ ! -f "$CONFIG_FILE" ]]; then
    if [[ ! -f "$CONFIG_TEMPLATE" ]]; then
      echo "Missing config template: $CONFIG_TEMPLATE" >&2
      exit 1
    fi
    mkdir -p "$(dirname "$CONFIG_FILE")"
    cp "$CONFIG_TEMPLATE" "$CONFIG_FILE"
  fi
}

update_json_key() {
  local file="$1"
  local key="$2"
  local value="$3"
  python3 - "$file" "$key" "$value" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]

data = {}
if path.exists():
    text = path.read_text(encoding="utf-8").strip()
    if text:
        data = json.loads(text)

if not isinstance(data, dict):
    raise SystemExit(f"Expected JSON object in {path}")

data[key] = value
path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
PY
}

start_backend_containers() {
  echo "Starting backend containers..."
  (
    cd "$ROOT_DIR"
    if is_enabled "$SYNC_INFISICAL"; then
      require_command infisical
      build_infisical_flags
      infisical run "${INFISICAL_FLAGS[@]}" -- docker compose up -d --build db backend >/dev/null
    else
      docker compose up -d --build db backend >/dev/null
    fi
  )
}

sync_mobile_api_base_url() {
  local tunnel_url="$1"
  ensure_config_file
  update_json_key "$CONFIG_FILE" "TELEMED_API_BASE_URL" "$tunnel_url"
  echo "- Updated mobile config: $CONFIG_FILE"

  if is_enabled "$SYNC_INFISICAL"; then
    build_infisical_flags
    infisical secrets set "TELEMED_API_BASE_URL=${tunnel_url}" "${INFISICAL_FLAGS[@]}" >/dev/null
    echo "- Updated Infisical: TELEMED_API_BASE_URL"
  fi
}

main() {
  require_command cloudflared
  require_command docker
  require_command grep
  require_command curl
  require_command python3

  start_backend_containers

  echo "Starting backend Cloudflare tunnel..."
  stop_previous_tunnel_if_any
  : >"$TUNNEL_LOG_FILE"
  cloudflared tunnel --url "$BACKEND_URL" >"$TUNNEL_LOG_FILE" 2>&1 &
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
    echo "Unable to detect backend tunnel URL. Check log: $TUNNEL_LOG_FILE" >&2
    exit 1
  fi

  if ! is_valid_tunnel_url "$tunnel_url"; then
    echo "Detected invalid backend tunnel URL: $tunnel_url" >&2
    echo "Check log: $TUNNEL_LOG_FILE" >&2
    exit 1
  fi

  verify_tunnel_health "$tunnel_url"
  sync_mobile_api_base_url "$tunnel_url"

  cat <<EOF

Ready.
- Backend tunnel URL: $tunnel_url
- Cloudflared PID: $tunnel_pid
- Tunnel log: $TUNNEL_LOG_FILE
- Mobile config: $CONFIG_FILE

Run patient app with:
  cd "$ROOT_DIR/mobile/patient_flutter_app"
  flutter run --dart-define-from-file="$CONFIG_FILE"

Stop tunnel later:
  kill \$(cat "$TUNNEL_PID_FILE")
EOF
}

main "$@"
