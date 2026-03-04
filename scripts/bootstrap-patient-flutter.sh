#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/mobile/patient_flutter_app"

if ! command -v flutter >/dev/null 2>&1; then
  echo "flutter command not found. Install Flutter SDK first: https://docs.flutter.dev/get-started/install"
  exit 1
fi

if [[ ! -d "$APP_DIR" ]]; then
  echo "Missing app directory: $APP_DIR"
  exit 1
fi

cd "$APP_DIR"

if [[ ! -d ios || ! -d android ]]; then
  echo "Generating iOS/Android project files..."
  TEMPLATE_BACKUP_DIR="$(mktemp -d)"
  cp -R lib "$TEMPLATE_BACKUP_DIR/lib"
  cp pubspec.yaml "$TEMPLATE_BACKUP_DIR/pubspec.yaml"
  cp analysis_options.yaml "$TEMPLATE_BACKUP_DIR/analysis_options.yaml"
  cp .gitignore "$TEMPLATE_BACKUP_DIR/.gitignore"
  cp README.md "$TEMPLATE_BACKUP_DIR/README.md"

  flutter create --platforms=ios,android --project-name patient_flutter_app .

  cp -R "$TEMPLATE_BACKUP_DIR/lib" "$APP_DIR/"
  cp "$TEMPLATE_BACKUP_DIR/pubspec.yaml" "$APP_DIR/pubspec.yaml"
  cp "$TEMPLATE_BACKUP_DIR/analysis_options.yaml" "$APP_DIR/analysis_options.yaml"
  cp "$TEMPLATE_BACKUP_DIR/.gitignore" "$APP_DIR/.gitignore"
  cp "$TEMPLATE_BACKUP_DIR/README.md" "$APP_DIR/README.md"
  rm -rf "$TEMPLATE_BACKUP_DIR"
fi

echo "Fetching Flutter dependencies..."
flutter pub get

cat <<'EOF'

Bootstrap complete.

Run on iPhone example:
  flutter run \
    --dart-define=ZEGO_APP_ID=1477525628 \
    --dart-define=ZEGO_APP_SIGN=<YOUR_APP_SIGN> \
    --dart-define=TELEMED_API_BASE_URL=http://192.168.1.219:8000

Important:
- iPhone and backend machine must be on same network.
- Use your LAN IP for TELEMED_API_BASE_URL, not localhost.
EOF
