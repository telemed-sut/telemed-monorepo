#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

is_enabled() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

has_runtime_env() {
  [[ -n "${DATABASE_URL:-}" ]] \
    || [[ -n "${JWT_SECRET:-}" ]] \
    || [[ -n "${NEXT_PUBLIC_API_BASE_URL:-}" ]] \
    || [[ -n "${NEXT_SERVER_API_BASE_URL:-}" ]]
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

    # Only export if not already set by shell
    if [[ -z "${!key+x}" ]]; then
      export "$key=$value"
    fi
  done < "$env_file"
}

load_default_runtime_env() {
  # Higher-priority files are loaded first because load_env_file_if_present
  # preserves values that are already present in the shell environment.
  if [[ "$target_dir" == "$ROOT_DIR/backend" ]]; then
    load_env_file_if_present "$ROOT_DIR/backend/.env.local"
    load_env_file_if_present "$ROOT_DIR/backend/.env"
  elif [[ "$target_dir" == "$ROOT_DIR/frontend" ]]; then
    load_env_file_if_present "$ROOT_DIR/frontend/.env.local"
    load_env_file_if_present "$ROOT_DIR/frontend/.env"
  fi

  load_env_file_if_present "$ROOT_DIR/.env.local"
  load_env_file_if_present "$ROOT_DIR/.env"
}

main() {
  local target_dir="$ROOT_DIR"

  if [[ "${1:-}" == "--cwd" ]]; then
    if [[ $# -lt 3 ]]; then
      echo "Usage: $0 [--cwd <relative-path>] <command> [args...]" >&2
      exit 1
    fi

    target_dir="$ROOT_DIR/$2"
    shift 2
  fi

  if [[ $# -eq 0 ]]; then
    echo "Usage: $0 [--cwd <relative-path>] <command> [args...]" >&2
    exit 1
  fi

  cd "$target_dir"

  if ! is_enabled "${USE_INFISICAL:-false}"; then
    load_default_runtime_env
    exec "$@"
  fi

  if has_runtime_env; then
    exec "$@"
  fi

  if ! command -v infisical >/dev/null 2>&1; then
    echo "infisical CLI is required when USE_INFISICAL=true" >&2
    echo "Install and login first, or run with USE_INFISICAL=false for fallback mode." >&2
    exit 1
  fi

  infisical_args=()
  if [[ -n "${INFISICAL_RUN_ARGS:-}" ]]; then
    # shellcheck disable=SC2206
    infisical_args=(${INFISICAL_RUN_ARGS})
  fi

  if (( ${#infisical_args[@]} > 0 )); then
    exec infisical run "${infisical_args[@]}" -- "$@"
  fi

  exec infisical run -- "$@"
}

main "$@"
