#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"

if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
  echo "TEST_DATABASE_URL is required for the PostgreSQL subset run." >&2
  exit 1
fi

TEST_FILES=(
  tests/test_users.py
  tests/test_patients.py
  tests/test_dense_mode_access.py
  tests/test_audit_logs.py
  tests/test_security_admin_endpoints.py
  tests/test_stats_and_audit_contracts.py
)

cd "$BACKEND_DIR"
exec env \
  DATABASE_URL="$TEST_DATABASE_URL" \
  TEST_DATABASE_URL="$TEST_DATABASE_URL" \
  JWT_SECRET="${JWT_SECRET:-test-secret-key}" \
  JWT_EXPIRES_IN="${JWT_EXPIRES_IN:-3600}" \
  RUN_TEST_MIGRATIONS="${RUN_TEST_MIGRATIONS:-true}" \
  ./venv/bin/python -m pytest -q "${TEST_FILES[@]}"
