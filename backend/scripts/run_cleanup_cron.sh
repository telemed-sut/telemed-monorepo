#!/bin/bash

# Source environment variables if needed
if [ -f /Volumes/P1Back/telemed-monorepo/backend/.env ]; then
    set -a
    . /Volumes/P1Back/telemed-monorepo/backend/.env
    set +a
fi

# Navigate to the backend directory
cd /Volumes/P1Back/telemed-monorepo/backend

# Run the cleanup script using the virtual environment
venv/bin/python scripts/cleanup_audit_logs.py >> logs/cron_cleanup.log 2>&1

