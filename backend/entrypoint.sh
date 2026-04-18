#!/bin/sh
set -e

DATABASE_WAIT_TIMEOUT_SECONDS="${DATABASE_WAIT_TIMEOUT_SECONDS:-60}"
DATABASE_WAIT_INTERVAL_SECONDS="${DATABASE_WAIT_INTERVAL_SECONDS:-2}"

is_enabled() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

normalize_database_url() {
  if [ -z "${DATABASE_URL:-}" ]; then
    return 0
  fi

  DATABASE_URL="$(python - <<'PY'
import os
from urllib.parse import quote, urlsplit, urlunsplit

database_url = os.environ["DATABASE_URL"].strip()
if database_url.startswith("postgres://"):
    database_url = f"postgresql+psycopg://{database_url[len('postgres://'):]}"
elif database_url.startswith("postgresql://"):
    database_url = f"postgresql+psycopg://{database_url[len('postgresql://'):]}"

parsed = urlsplit(database_url)
if (
    os.path.exists("/.dockerenv")
    and parsed.scheme in {"postgresql+psycopg", "postgresql", "postgres"}
    and parsed.hostname in {"localhost", "127.0.0.1"}
):
    username = quote(parsed.username or "", safe="")
    password = quote(parsed.password or "", safe="")
    auth = username
    if parsed.password is not None:
        auth = f"{auth}:{password}" if auth else f":{password}"
    if auth:
        auth = f"{auth}@"
    port = f":{parsed.port}" if parsed.port else ""
    database_url = urlunsplit(
        (parsed.scheme, f"{auth}db{port}", parsed.path, parsed.query, parsed.fragment)
    )

print(database_url, end="")
PY
)"
  export DATABASE_URL
}

wait_for_database() {
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "DATABASE_URL is not set; cannot wait for database." >&2
    exit 1
  fi

  python - <<'PY'
import os
import sys
import time

from sqlalchemy import create_engine, text

database_url = os.environ["DATABASE_URL"]
if database_url.startswith("postgres://"):
    database_url = f"postgresql+psycopg://{database_url[len('postgres://'):]}"
elif database_url.startswith("postgresql://"):
    database_url = f"postgresql+psycopg://{database_url[len('postgresql://'):]}"
timeout_seconds = max(int(os.environ.get("DATABASE_WAIT_TIMEOUT_SECONDS", "60")), 1)
interval_seconds = max(float(os.environ.get("DATABASE_WAIT_INTERVAL_SECONDS", "2")), 0.5)
deadline = time.monotonic() + timeout_seconds
last_error = None

while time.monotonic() < deadline:
    try:
        engine = create_engine(database_url, pool_pre_ping=True)
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        print("Database is reachable.")
        sys.exit(0)
    except Exception as exc:  # noqa: BLE001
        last_error = exc
        print(f"Waiting for database: {exc}", flush=True)
        time.sleep(interval_seconds)

print(f"Database was not reachable within {timeout_seconds} seconds: {last_error}", file=sys.stderr)
sys.exit(1)
PY
}

normalize_legacy_alembic_state() {
  python - <<'PY'
import os

from app.db.alembic_compat import (
    ensure_single_alembic_head,
    format_alembic_preflight,
    normalize_legacy_alembic_revision,
)

ensure_single_alembic_head()
print(format_alembic_preflight(os.environ["DATABASE_URL"]))
result = normalize_legacy_alembic_revision(os.environ["DATABASE_URL"])
print(result.message)
print(format_alembic_preflight(os.environ["DATABASE_URL"]))
PY
}

run_migrations() {
  echo "🔄 Running database migrations..."
  normalize_legacy_alembic_state
  alembic upgrade head
}

run_seed() {
  echo "🌱 Seeding initial data..."
  python -m scripts.seed
}

start_api() {
  echo "🚀 Starting application..."
  FORWARDED_ALLOW_IPS="${FORWARDED_ALLOW_IPS:-${TRUSTED_PROXY_IPS:-127.0.0.1,::1}}"
  exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --proxy-headers \
    --forwarded-allow-ips "$FORWARDED_ALLOW_IPS"
}

normalize_database_url

echo "⏳ Waiting for database..."
wait_for_database

if is_enabled "${RUN_MIGRATIONS_ON_STARTUP:-true}"; then
  run_migrations
else
  echo "⏭️ Skipping database migrations (RUN_MIGRATIONS_ON_STARTUP disabled)"
fi

if is_enabled "${RUN_SEED_ON_STARTUP:-false}"; then
  run_seed
else
  echo "⏭️ Skipping seed data (RUN_SEED_ON_STARTUP disabled)"
fi

start_api
