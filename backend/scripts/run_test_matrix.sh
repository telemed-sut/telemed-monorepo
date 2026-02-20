#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-all}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

run_compat() {
  echo "==> Running compat profile (full suite)"
  DATABASE_URL="${DATABASE_URL:-sqlite:///./test_matrix.db}" \
  JWT_SECRET="${JWT_SECRET:-test-secret-key}" \
  JWT_EXPIRES_IN="${JWT_EXPIRES_IN:-3600}" \
  DEVICE_API_ALLOW_JWT_SECRET_FALLBACK="${DEVICE_API_ALLOW_JWT_SECRET_FALLBACK:-false}" \
  DEVICE_API_REQUIRE_REGISTERED_DEVICE=false \
  DEVICE_API_REQUIRE_BODY_HASH_SIGNATURE=false \
  DEVICE_API_REQUIRE_NONCE=false \
  python -m pytest -q
}

run_strict() {
  echo "==> Running strict profile (device security smoke test)"
  DATABASE_URL="${DATABASE_URL:-sqlite:///./test_matrix.db}" \
  JWT_SECRET="${JWT_SECRET:-test-secret-key}" \
  JWT_EXPIRES_IN="${JWT_EXPIRES_IN:-3600}" \
  DEVICE_API_ALLOW_JWT_SECRET_FALLBACK=false \
  DEVICE_API_REQUIRE_REGISTERED_DEVICE=true \
  DEVICE_API_REQUIRE_BODY_HASH_SIGNATURE=true \
  DEVICE_API_REQUIRE_NONCE=true \
  DEVICE_API_SECRETS='{"strict-device-001":"strict_device_secret_001_1234567890abcdef1234567890abc"}' \
  python -m pytest -q tests/test_pressure_security.py::test_add_pressure_accepts_strict_mode_with_registered_device
}

case "$PROFILE" in
  compat)
    run_compat
    ;;
  strict)
    run_strict
    ;;
  all)
    run_compat
    run_strict
    ;;
  *)
    echo "Usage: ./scripts/run_test_matrix.sh [compat|strict|all]" >&2
    exit 1
    ;;
esac
