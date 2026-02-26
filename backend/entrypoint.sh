#!/bin/sh
set -e

is_enabled() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

if is_enabled "${RUN_MIGRATIONS_ON_STARTUP:-true}"; then
  echo "🔄 Running database migrations..."
  alembic upgrade head
else
  echo "⏭️ Skipping database migrations (RUN_MIGRATIONS_ON_STARTUP disabled)"
fi

if is_enabled "${RUN_SEED_ON_STARTUP:-true}"; then
  echo "🌱 Seeding initial data..."
  python -m scripts.seed
else
  echo "⏭️ Skipping seed data (RUN_SEED_ON_STARTUP disabled)"
fi

echo "🚀 Starting application..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
