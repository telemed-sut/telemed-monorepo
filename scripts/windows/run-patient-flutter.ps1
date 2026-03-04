param(
  [string]$ConfigFile = "",
  [string]$DeviceId = ""
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

$cmdArgs = @("run", "--dart-define-from-file=$ConfigFile")
if (-not [string]::IsNullOrWhiteSpace($DeviceId)) {
  $cmdArgs += "--device-id=$DeviceId"
}

Push-Location $appDir
try {
  flutter pub get
  & flutter @cmdArgs
}
finally {
  Pop-Location
}
