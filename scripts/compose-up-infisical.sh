#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

is_enabled() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

main() {
  cd "$ROOT_DIR"

  # If required env has already been injected (e.g. outer `infisical run`),
  # skip calling infisical again to avoid nested-run failures.
  if [[ -n "${DATABASE_URL:-}" && -n "${JWT_SECRET:-}" ]]; then
    exec ./scripts/start-compose.sh "$@"
  fi

  if is_enabled "${USE_INFISICAL:-false}"; then
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
      exec infisical run "${infisical_args[@]}" -- ./scripts/start-compose.sh "$@"
    fi

    exec infisical run -- ./scripts/start-compose.sh "$@"
  fi

  exec ./scripts/start-compose.sh "$@"
}

main "$@"
