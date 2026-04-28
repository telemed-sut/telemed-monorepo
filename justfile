# Root command runner for common telemed monorepo workflows.

[default]
help:
  @just --list

doctor:
  #!/usr/bin/env bash
  set -euo pipefail

  missing=0

  check_command() {
    local name="$1"
    local description="$2"

    if command -v "$name" >/dev/null 2>&1; then
      echo "[ok] $name"
    else
      echo "[missing] $name - $description" >&2
      missing=1
    fi
  }

  echo "Checking local prerequisites for the telemed monorepo..."
  check_command python3 "Required for backend tooling."
  check_command npm "Required for frontend scripts."
  check_command docker "Required for the local backend stack."
  check_command infisical "Required for default secret injection workflows."

  if docker compose version >/dev/null 2>&1; then
    echo "[ok] docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    echo "[ok] docker-compose"
  else
    echo "[missing] docker compose - Required by ./scripts/dev-backend.sh." >&2
    missing=1
  fi

  if [ -x backend/venv/bin/python ]; then
    echo "[ok] backend virtual environment"
  else
    echo "[missing] backend/venv - Run \`just backend-test-env\`." >&2
    missing=1
  fi

  if [ -x backend/venv/bin/python ]; then
    if backend/venv/bin/python -m ruff --version >/dev/null 2>&1; then
      echo "[ok] backend ruff"
    else
      echo "[missing] backend ruff - Install it in backend/venv for \`just ci\`." >&2
      missing=1
    fi
  fi

  if [ -d frontend/node_modules ]; then
    echo "[ok] frontend dependencies"
  else
    echo "[missing] frontend/node_modules - Install frontend dependencies first." >&2
    missing=1
  fi

  if [ "$missing" -ne 0 ]; then
    echo
    echo "Local setup is incomplete." >&2
    exit 1
  fi

  echo
  echo "Local setup looks ready."
  echo "Next step: run \`just doctor-backend-env\` to validate Infisical-backed backend runtime config before \`just dev-backend\`."

dev-backend:
  ./scripts/dev-backend.sh

doctor-backend-env:
  ./scripts/run-with-infisical.sh ./scripts/check-compose-env.sh db backend

dev-frontend:
  ./scripts/dev-frontend.sh

dev:
  #!/usr/bin/env bash
  set -euo pipefail

  backend_pid=""
  health_url="http://localhost:8000/health"
  max_attempts=90

  cleanup() {
    if [ -n "${backend_pid:-}" ] && kill -0 "$backend_pid" >/dev/null 2>&1; then
      echo
      echo "Stopping background backend process..."
      kill "$backend_pid" >/dev/null 2>&1 || true
      wait "$backend_pid" 2>/dev/null || true
    fi
  }

  trap cleanup EXIT INT TERM

  echo "Starting backend in the background..."
  ./scripts/dev-backend.sh &
  backend_pid=$!

  echo "Waiting for backend health at ${health_url}..."
  for attempt in $(seq 1 "$max_attempts"); do
    if ! kill -0 "$backend_pid" >/dev/null 2>&1; then
      echo "Backend process exited before becoming healthy." >&2
      exit 1
    fi

    if curl --silent --fail --output /dev/null "$health_url"; then
      echo "Backend is healthy."
      break
    fi

    if [ "$attempt" -eq "$max_attempts" ]; then
      echo "Backend did not become healthy within ${max_attempts} seconds." >&2
      exit 1
    fi

    sleep 1
  done

  echo "Starting frontend in the foreground..."
  ./scripts/dev-frontend.sh

dev-api:
  ./scripts/dev-api.sh

share-link:
  ./scripts/dev-share-link.sh

test-backend:
  ./scripts/test-backend.sh

test-frontend:
  ./scripts/test-frontend.sh

build-frontend:
  ./scripts/build-frontend.sh

migrate-backend:
  ./scripts/migrate-backend.sh

seed-backend:
  ./scripts/seed-backend.sh

backend-test-env:
  make -C backend backend-test-env

backend-lint:
  #!/usr/bin/env bash
  set -euo pipefail

  if ! backend/venv/bin/python -m ruff --version >/dev/null 2>&1; then
    echo "Ruff is not installed in backend/venv." >&2
    echo "Install it before running \`just backend-lint\` or \`just ci\`." >&2
    exit 1
  fi

  cd backend
  ./venv/bin/python -m ruff check app tests --select E9,F63,F7,F82

backend-head-check:
  #!/usr/bin/env bash
  set -euo pipefail

  ./scripts/run-with-infisical.sh --cwd backend bash -lc '
    head_count=$(./venv/bin/alembic heads | grep -c "(head)")
    if [ "$head_count" -ne 1 ]; then
      echo "Expected exactly 1 alembic head, got $head_count" >&2
      ./venv/bin/alembic heads
      exit 1
    fi
  '

backend-compile:
  cd backend && ./venv/bin/python -m py_compile app/api/users.py app/api/meetings.py app/api/patients.py app/services/meeting.py

frontend-typecheck:
  cd frontend && npx tsc --noEmit

frontend-lint:
  cd frontend && npx eslint lib/api.ts components/dashboard/users-table.tsx components/dashboard/patient-assignments-dialog.tsx

ci-backend: backend-lint backend-head-check backend-compile test-backend

ci-frontend: frontend-typecheck frontend-lint test-frontend build-frontend

ci: ci-backend ci-frontend

ci-fast: backend-lint backend-compile frontend-typecheck frontend-lint

check: test-backend test-frontend build-frontend
