#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"
exec ./scripts/run-with-infisical.sh --cwd backend ./venv/bin/python -m scripts.seed "$@"
