Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$appDir = Join-Path $repoRoot "mobile\patient_flutter_app"

if (-not (Get-Command flutter -ErrorAction SilentlyContinue)) {
  throw "flutter command not found. Install Flutter SDK first."
}

if (-not (Test-Path $appDir)) {
  throw "App directory not found: $appDir"
}

Push-Location $appDir
try {
  if (-not (Test-Path (Join-Path $appDir "android"))) {
    Write-Host "Generating Android folder..." -ForegroundColor Cyan
    flutter create --platforms=android --project-name patient_flutter_app .
  }

  if (-not (Test-Path (Join-Path $appDir "ios"))) {
    Write-Host "iOS folder is missing (not required on Windows)." -ForegroundColor Yellow
    Write-Host "If you need iOS build, generate on macOS with ./scripts/bootstrap-patient-flutter.sh" -ForegroundColor Yellow
  }

  Write-Host "Installing Flutter dependencies..." -ForegroundColor Cyan
  flutter pub get
}
finally {
  Pop-Location
}

Write-Host ""
Write-Host "Bootstrap complete." -ForegroundColor Green
Write-Host "Next step:"
Write-Host "  Copy mobile\patient_flutter_app\config\dart_defines.example.json to dart_defines.local.json and fill ZEGO_APP_SIGN."
