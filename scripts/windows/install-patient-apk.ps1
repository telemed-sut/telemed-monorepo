param(
  [string]$ApkPath = "",
  [string]$DeviceId = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$appDir = Join-Path $repoRoot "mobile\patient_flutter_app"

if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
  throw "adb command not found. Install Android platform-tools first."
}

if ([string]::IsNullOrWhiteSpace($ApkPath)) {
  $ApkPath = Join-Path $appDir "build\app\outputs\flutter-apk\app-release.apk"
}

if (-not (Test-Path $ApkPath)) {
  throw "APK not found: $ApkPath`nBuild first with scripts/windows/build-patient-apk.ps1"
}

$cmdArgs = @("install", "-r", $ApkPath)
if (-not [string]::IsNullOrWhiteSpace($DeviceId)) {
  $cmdArgs = @("-s", $DeviceId) + $cmdArgs
}

& adb @cmdArgs
Write-Host "Installed: $ApkPath" -ForegroundColor Green
