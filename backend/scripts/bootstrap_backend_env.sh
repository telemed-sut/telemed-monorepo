#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${VENV_DIR:-$ROOT_DIR/venv}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
UPGRADE_PIP="${UPGRADE_PIP:-0}"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Python interpreter not found: $PYTHON_BIN" >&2
  echo "Set PYTHON_BIN to a valid Python 3.11+ executable and try again." >&2
  exit 1
fi

PYTHON_VERSION="$("$PYTHON_BIN" -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')"
PYTHON_MAJOR_MINOR="$("$PYTHON_BIN" -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")')"

case "$PYTHON_MAJOR_MINOR" in
  3.11|3.12|3.13) ;;
  *)
    echo "Unsupported Python version: $PYTHON_VERSION" >&2
    echo "Use Python 3.11 or newer." >&2
    exit 1
    ;;
esac

if [ ! -d "$VENV_DIR" ]; then
  echo "==> Creating backend virtual environment at $VENV_DIR"
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

echo "==> Using Python $PYTHON_VERSION"
echo "==> Syncing dependencies into $VENV_DIR"
if [ "$UPGRADE_PIP" = "1" ]; then
  "$VENV_DIR/bin/python" -m pip install --disable-pip-version-check --upgrade pip
fi
"$VENV_DIR/bin/python" -m pip install --disable-pip-version-check -r "$ROOT_DIR/requirements.txt"

echo "==> Verifying installed packages"
"$VENV_DIR/bin/python" -m pip check

echo "==> Verifying pytest plugin availability"
"$VENV_DIR/bin/python" -m pip show pytest pytest-asyncio >/dev/null

echo "==> Backend environment is ready"
echo "Activate with: source \"$VENV_DIR/bin/activate\""
