param(
  [Parameter(Mandatory = $true)]
  [string]$ApiBaseUrl,
  [string]$ConfigFile = "",
  [string]$DeviceId = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Normalize-ApiBaseUrl {
  param([string]$Value)

  $trimmed = $Value.Trim()
  if ([string]::IsNullOrWhiteSpace($trimmed)) {
    throw "ApiBaseUrl is required."
  }

  $uri = $null
  if (-not [System.Uri]::TryCreate($trimmed, [System.UriKind]::Absolute, [ref]$uri)) {
    throw "ApiBaseUrl must be a valid absolute URL (example: https://your-domain.trycloudflare.com)."
  }

  if ($uri.Scheme -ne "http" -and $uri.Scheme -ne "https") {
    throw "ApiBaseUrl must start with http:// or https://"
  }

  $normalized = $trimmed.TrimEnd("/")
  if ($normalized.Contains(" ")) {
    throw "ApiBaseUrl must not contain spaces."
  }

  return $normalized
}

function Read-JsonObject {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return @{}
  }

  $raw = Get-Content -Raw -Path $Path
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return @{}
  }

  $obj = $raw | ConvertFrom-Json
  if ($null -eq $obj) {
    return @{}
  }

  if ($obj -is [hashtable]) {
    return $obj
  }

  $result = @{}
  foreach ($prop in $obj.PSObject.Properties) {
    $result[$prop.Name] = $prop.Value
  }
  return $result
}

function Write-JsonObject {
  param(
    [string]$Path,
    [hashtable]$Data
  )

  $dir = Split-Path -Parent $Path
  if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }

  $json = $Data | ConvertTo-Json -Depth 10
  Set-Content -Path $Path -Value $json -Encoding UTF8
}

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

$example = Join-Path $appDir "config\dart_defines.example.json"
if (-not (Test-Path $ConfigFile) -and (Test-Path $example)) {
  Copy-Item -Path $example -Destination $ConfigFile -Force
}

$normalizedApiBaseUrl = Normalize-ApiBaseUrl -Value $ApiBaseUrl
$config = Read-JsonObject -Path $ConfigFile

$zegoAppId = "$($config.ZEGO_APP_ID)".Trim()
$zegoAppSign = "$($config.ZEGO_APP_SIGN)".Trim()

if ([string]::IsNullOrWhiteSpace($zegoAppId)) {
  throw "ZEGO_APP_ID is missing in $ConfigFile"
}

if ([string]::IsNullOrWhiteSpace($zegoAppSign) -or $zegoAppSign -eq "REPLACE_WITH_ZEGO_APP_SIGN") {
  throw "ZEGO_APP_SIGN is missing in $ConfigFile"
}

$config["TELEMED_API_BASE_URL"] = $normalizedApiBaseUrl
Write-JsonObject -Path $ConfigFile -Data $config

$cmdArgs = @(
  "run",
  "--dart-define=ZEGO_APP_ID=$zegoAppId",
  "--dart-define=ZEGO_APP_SIGN=$zegoAppSign",
  "--dart-define=TELEMED_API_BASE_URL=$normalizedApiBaseUrl"
)

if (-not [string]::IsNullOrWhiteSpace($DeviceId)) {
  $cmdArgs += "--device-id=$DeviceId"
}

Write-Host "Using TELEMED_API_BASE_URL: $normalizedApiBaseUrl" -ForegroundColor Cyan
Write-Host "Config updated: $ConfigFile" -ForegroundColor Cyan

Push-Location $appDir
try {
  flutter pub get
  & flutter @cmdArgs
}
finally {
  Pop-Location
}
