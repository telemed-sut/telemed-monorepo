param(
  [string]$ConfigFile = "",
  [switch]$SplitPerAbi
)

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

if ([string]::IsNullOrWhiteSpace($ConfigFile)) {
  $ConfigFile = Join-Path $appDir "config\dart_defines.local.json"
}

if (-not (Test-Path $ConfigFile)) {
  $example = Join-Path $appDir "config\dart_defines.example.json"
  throw "Config file not found: $ConfigFile`nCopy this template and fill values first: $example"
}

$cmdArgs = @("build", "apk", "--release", "--dart-define-from-file=$ConfigFile")
if ($SplitPerAbi) {
  $cmdArgs += "--split-per-abi"
}

Push-Location $appDir
try {
  flutter pub get
  & flutter @cmdArgs
}
finally {
  Pop-Location
}

$apkPath = Join-Path $appDir "build\app\outputs\flutter-apk\app-release.apk"
if (Test-Path $apkPath) {
  Write-Host ""
  Write-Host "APK ready: $apkPath" -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "Build finished. Check output in: $appDir\build\app\outputs\flutter-apk" -ForegroundColor Yellow
}
