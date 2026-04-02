$ErrorActionPreference = "Stop"

$KieAffiliateUrl = "https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42"
$DefaultLocalOpenAiBaseUrl = "http://127.0.0.1:8080/v1"
$KieRepoUrl = "https://github.com/gateway/kie-api.git"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$MediaRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$EnvFile = Join-Path $MediaRoot ".env"
$ParentRoot = Split-Path $MediaRoot -Parent
$DefaultKieRoot = Join-Path $ParentRoot "kie-api"
$LegacyKieRoot = Join-Path (Join-Path $ParentRoot "kie-ai") "kie_codex_bootstrap"

if ($env:KIE_ROOT) {
  $KieRoot = $env:KIE_ROOT
} elseif ($env:MEDIA_STUDIO_KIE_API_REPO_PATH) {
  $KieRoot = $env:MEDIA_STUDIO_KIE_API_REPO_PATH
} elseif (Test-Path $DefaultKieRoot) {
  $KieRoot = $DefaultKieRoot
} else {
  $KieRoot = $DefaultKieRoot
}

$VenvPy = Join-Path $KieRoot ".venv\Scripts\python.exe"
$VenvPip = Join-Path $KieRoot ".venv\Scripts\pip.exe"

function Require-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

function Ensure-EnvFile {
  if (Test-Path $EnvFile) {
    return
  }

  $envTemplate = @"
NEXT_PUBLIC_MEDIA_STUDIO_CONTROL_API_BASE_URL=http://127.0.0.1:8000
MEDIA_STUDIO_CONTROL_API_BASE_URL=http://127.0.0.1:8000
MEDIA_STUDIO_API_HOST=127.0.0.1
MEDIA_STUDIO_API_PORT=8000
MEDIA_STUDIO_DB_PATH=$(Join-Path $MediaRoot "data\media-studio.db")
MEDIA_STUDIO_DATA_ROOT=$(Join-Path $MediaRoot "data")
MEDIA_STUDIO_KIE_API_REPO_PATH=$KieRoot
MEDIA_STUDIO_SUPERVISOR=manual
MEDIA_ENABLE_LIVE_SUBMIT=false
MEDIA_BACKGROUND_POLL_ENABLED=true
MEDIA_POLL_SECONDS=6
MEDIA_PRICING_CACHE_HOURS=6
KIE_API_KEY=
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
MEDIA_LOCAL_OPENAI_BASE_URL=$DefaultLocalOpenAiBaseUrl
MEDIA_LOCAL_OPENAI_API_KEY=
"@
  Set-Content -Path $EnvFile -Value $envTemplate
  Write-Host "Created .env with local defaults."
}

function Get-EnvValue {
  param([string]$Key)

  if (-not (Test-Path $EnvFile)) {
    return ""
  }

  $prefix = "$Key="
  foreach ($line in Get-Content -Path $EnvFile) {
    if ($line.StartsWith($prefix)) {
      return $line.Substring($prefix.Length)
    }
  }
  return ""
}

function Set-EnvValue {
  param(
    [string]$Key,
    [string]$Value
  )

  $lines = @()
  if (Test-Path $EnvFile) {
    $lines = [System.Collections.Generic.List[string]]::new()
    foreach ($line in Get-Content -Path $EnvFile) {
      $null = $lines.Add($line)
    }
  } else {
    $lines = [System.Collections.Generic.List[string]]::new()
  }

  $prefix = "$Key="
  $updated = $false
  for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index].StartsWith($prefix)) {
      $lines[$index] = "$prefix$Value"
      $updated = $true
      break
    }
  }

  if (-not $updated) {
    $null = $lines.Add("$prefix$Value")
  }

  Set-Content -Path $EnvFile -Value $lines
}

function Read-SecretOrBlank {
  param([string]$Prompt)

  $secure = Read-Host -Prompt $Prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Start-DevWindow {
  param([string]$Command)

  Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$MediaRoot'; $Command"
  ) | Out-Null
}

Require-Command git
Require-Command python
Require-Command npm
Require-Command powershell

Write-Host ""
Write-Host "Media Studio Windows onboarding"
Write-Host "Workspace: $MediaRoot"
Write-Host ""
Write-Host "This script will:"
Write-Host " - bootstrap the shared KIE API dependency"
Write-Host " - create or reuse the shared Python runtime"
Write-Host " - create .env and a clean local database"
Write-Host " - prompt for your KIE API key and optional enhancement providers"
Write-Host ""

if (-not (Test-Path (Join-Path $KieRoot ".git"))) {
  Write-Host "Cloning KIE API repo from $KieRepoUrl ..."
  git clone $KieRepoUrl $KieRoot
}

if (-not (Test-Path $VenvPy)) {
  Write-Host "Creating shared KIE virtualenv ..."
  python -m venv (Join-Path $KieRoot ".venv")
}

Write-Host "Installing shared Python dependencies ..."
& $VenvPip install --upgrade pip setuptools wheel
& $VenvPip install -e $KieRoot
& $VenvPip install -e (Join-Path $MediaRoot "apps\api")
& $VenvPip install fastapi "uvicorn[standard]" python-multipart httpx "pytest-asyncio>=0.23,<1.0"

Write-Host "Installing web dependencies ..."
Push-Location $MediaRoot
npm install
Pop-Location

New-Item -ItemType Directory -Force -Path (Join-Path $MediaRoot "data") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $MediaRoot "data\uploads") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $MediaRoot "data\downloads") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $MediaRoot "data\outputs") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $MediaRoot "data\preset-thumbnails") | Out-Null

Ensure-EnvFile

Write-Host "Bootstrapping Media Studio schema ..."
$env:MEDIA_STUDIO_DB_PATH = Get-EnvValue "MEDIA_STUDIO_DB_PATH"
$env:MEDIA_STUDIO_DATA_ROOT = Get-EnvValue "MEDIA_STUDIO_DATA_ROOT"
$env:MEDIA_STUDIO_KIE_API_REPO_PATH = $KieRoot
$bootstrapScript = @'
import os
import sys
from pathlib import Path

media_root = Path(os.environ["MEDIA_STUDIO_DATA_ROOT"]).resolve().parents[0]
repo_root = media_root.parent
sys.path.insert(0, str(repo_root / "apps" / "api"))

from app import store

store.bootstrap_schema()
print("Schema ready at:", os.environ["MEDIA_STUDIO_DB_PATH"])
'@
$bootstrapScript | & $VenvPy -

Write-Host ""
Write-Host "Live image and video generation requires a KIE API key."
Write-Host "Get one here: $KieAffiliateUrl"
Write-Host "Press Enter without a key if you want to stay in offline mode for now."
Write-Host ""

$kieKey = Read-SecretOrBlank "Paste your KIE API key"
if ($kieKey) {
  Set-EnvValue "KIE_API_KEY" $kieKey
  Set-EnvValue "MEDIA_ENABLE_LIVE_SUBMIT" "true"
} elseif (-not (Get-EnvValue "KIE_API_KEY")) {
  Set-EnvValue "MEDIA_ENABLE_LIVE_SUBMIT" "false"
}

Write-Host ""
Write-Host "Optional prompt enhancement providers"
Write-Host " - OpenRouter: hosted prompt enhancement"
Write-Host " - Local OpenAI-compatible endpoint: local enhancement stack"
Write-Host ""

$openRouterKey = Read-SecretOrBlank "Optional OpenRouter API key"
if ($openRouterKey) {
  Set-EnvValue "OPENROUTER_API_KEY" $openRouterKey
}

$currentLocalBase = Get-EnvValue "MEDIA_LOCAL_OPENAI_BASE_URL"
if (-not $currentLocalBase) {
  $currentLocalBase = $DefaultLocalOpenAiBaseUrl
}
$localBase = Read-Host "Local OpenAI-compatible base URL [$currentLocalBase]"
if ($localBase) {
  Set-EnvValue "MEDIA_LOCAL_OPENAI_BASE_URL" $localBase
}

$localApiKey = Read-SecretOrBlank "Optional local OpenAI-compatible API key"
if ($localApiKey) {
  Set-EnvValue "MEDIA_LOCAL_OPENAI_API_KEY" $localApiKey
}

Write-Host ""
Write-Host "Current setup summary"
Write-Host " - KIE API key: $((if (Get-EnvValue 'KIE_API_KEY') { 'configured' } else { 'missing' }))"
Write-Host " - Live submit: $((if ((Get-EnvValue 'MEDIA_ENABLE_LIVE_SUBMIT') -eq 'true') { 'enabled' } else { 'offline' }))"
Write-Host " - OpenRouter: $((if (Get-EnvValue 'OPENROUTER_API_KEY') { 'configured' } else { 'skipped' }))"
Write-Host " - Local OpenAI base URL: $(Get-EnvValue 'MEDIA_LOCAL_OPENAI_BASE_URL')"
Write-Host ""
Write-Host "Next commands"
Write-Host " - API: npm run dev:api"
Write-Host " - Web: npm run dev:web"
Write-Host " - Setup page: http://127.0.0.1:3000/setup"
Write-Host ""

$launchNow = Read-Host "Open the API and web commands in new PowerShell windows now? [y/N]"
if ($launchNow -match '^[Yy]$') {
  Start-DevWindow "npm run dev:api"
  Start-DevWindow "npm run dev:web"
  Write-Host "Opening PowerShell windows for the API and web app."
}
