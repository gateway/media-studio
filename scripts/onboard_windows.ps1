$ErrorActionPreference = "Stop"

$KieAffiliateUrl = "https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42"
$DefaultLocalOpenAiBaseUrl = "http://127.0.0.1:8080/v1"
$KieRepoUrl = "https://github.com/gateway/kie-api.git"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$null = . (Join-Path $ScriptDir "shared_env.ps1")
$MediaRoot = Get-MediaRootFromScript $MyInvocation.MyCommand.Path
$EnvFile = Join-Path $MediaRoot ".env"
$KieRoot = Get-KieRoot $MediaRoot

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

$localControlToken = "media-studio-$([guid]::NewGuid().ToString('N'))"
$localInstallId = "install-$([guid]::NewGuid().ToString('N'))"
$envTemplate = @"
MEDIA_STUDIO_APP_ENV=development
NEXT_PUBLIC_MEDIA_STUDIO_CONTROL_API_BASE_URL=
MEDIA_STUDIO_CONTROL_API_BASE_URL=
NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG=
MEDIA_STUDIO_CONTROL_API_TOKEN=$localControlToken
MEDIA_STUDIO_INSTALL_ID=$localInstallId
MEDIA_STUDIO_ADMIN_USERNAME=
MEDIA_STUDIO_ADMIN_PASSWORD=
MEDIA_STUDIO_API_HOST=127.0.0.1
MEDIA_STUDIO_API_PORT=8000
MEDIA_STUDIO_WEB_HOST=127.0.0.1
MEDIA_STUDIO_WEB_PORT=3000
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
MEDIA_LOCAL_OPENAI_BASE_URL=
MEDIA_LOCAL_OPENAI_API_KEY=
"@
  Set-Content -Path $EnvFile -Value $envTemplate
  Write-Host "Created .env with local defaults and a unique control token."
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

function Format-ConfiguredStatus {
  param(
    [string]$Value,
    [string]$ConfiguredLabel = "configured",
    [string]$MissingLabel = "missing"
  )

  if ($Value) {
    return $ConfiguredLabel
  }
  return $MissingLabel
}

function Get-CodexLocalStatus {
  $codexCommand = Get-Command codex -ErrorAction SilentlyContinue
  $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
  $authPath = Join-Path $codexHome "auth.json"
  if (-not $codexCommand) {
    return "not installed"
  }
  if (Test-Path $authPath) {
    return "ready"
  }
  return "login needed"
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
Require-Command node
Require-Command npm
Require-Command powershell

Write-Host ""
Write-Host "Media Studio Windows onboarding"
Write-Host "Workspace: $MediaRoot"
Write-Host ""
Write-Host "This script will:"
Write-Host " - prepare the shared KIE dependency and Python runtime"
Write-Host " - install or refresh the local web dependencies"
Write-Host " - create or reuse .env, data folders, and the local database schema"
Write-Host " - prompt for KIE, OpenRouter, and Local OpenAI setup"
Write-Host " - check whether Codex Local is already ready on this machine"
Write-Host ""

if ((-not (Test-Path (Join-Path $KieRoot ".git"))) -and (-not (Test-Path (Join-Path $KieRoot "pyproject.toml")))) {
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

Write-Host "Installing web dependencies ..."
Push-Location $MediaRoot
npm install --include=dev --no-fund --no-audit
Pop-Location

New-Item -ItemType Directory -Force -Path (Join-Path $MediaRoot "data") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $MediaRoot "data\uploads") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $MediaRoot "data\downloads") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $MediaRoot "data\outputs") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $MediaRoot "data\preset-thumbnails") | Out-Null

Ensure-EnvFile
if (-not (Get-EnvValue "MEDIA_STUDIO_INSTALL_ID")) {
  Set-EnvValue "MEDIA_STUDIO_INSTALL_ID" "install-$([guid]::NewGuid().ToString('N'))"
}

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
Write-Host "Optional LLM providers"
Write-Host " - Codex Local: $(Get-CodexLocalStatus) (powers Enhance, recipe drafts, and graph prompt nodes)"
Write-Host " - OpenRouter: hosted prompt enhancement and drafting"
Write-Host " - Local OpenAI-compatible endpoint: self-hosted enhancement and drafting"
Write-Host ""

if ((Read-Host "Configure OpenRouter now? This is optional and can be set up later in Settings. [y/N]") -match '^[Yy]$') {
  $openRouterKey = Read-SecretOrBlank "Optional OpenRouter API key"
  if ($openRouterKey) {
    Set-EnvValue "OPENROUTER_API_KEY" $openRouterKey
  }
} else {
  Write-Host "Skipping OpenRouter setup. You can enable it later in Settings."
}

if ((Read-Host "Configure a local OpenAI-compatible endpoint now? This is optional and can be set up later in Settings. [y/N]") -match '^[Yy]$') {
  $currentLocalBase = Get-EnvValue "MEDIA_LOCAL_OPENAI_BASE_URL"
  if (-not $currentLocalBase) {
    $currentLocalBase = $DefaultLocalOpenAiBaseUrl
  }
  $localBase = Read-Host "Local OpenAI-compatible base URL [$currentLocalBase]"
  if ($localBase) {
    Set-EnvValue "MEDIA_LOCAL_OPENAI_BASE_URL" $localBase
  } elseif (-not (Get-EnvValue "MEDIA_LOCAL_OPENAI_BASE_URL")) {
    Set-EnvValue "MEDIA_LOCAL_OPENAI_BASE_URL" $currentLocalBase
  }

  $localApiKey = Read-SecretOrBlank "Optional local OpenAI-compatible API key"
  if ($localApiKey) {
    Set-EnvValue "MEDIA_LOCAL_OPENAI_API_KEY" $localApiKey
  }
} else {
  Write-Host "Skipping local OpenAI-compatible setup. You can enable it later in Settings."
}

Write-Host ""
Write-Host "Current setup summary"
$kieKeyStatus = Format-ConfiguredStatus (Get-EnvValue "KIE_API_KEY") "configured" "missing"
$liveSubmitStatus = "offline"
if ((Get-EnvValue "MEDIA_ENABLE_LIVE_SUBMIT") -eq "true") {
  $liveSubmitStatus = "enabled"
}
$openRouterStatus = Format-ConfiguredStatus (Get-EnvValue "OPENROUTER_API_KEY") "configured" "skipped"
Write-Host " - KIE API key: $(if ($kieKeyStatus -eq 'configured') { 'Ready' } else { 'Not set up' })"
Write-Host " - Live submit: $(if ($liveSubmitStatus -eq 'enabled') { 'Ready' } else { 'Not set up' })"
Write-Host " - Codex Local: $(switch (Get-CodexLocalStatus) { 'ready' { 'Ready' } 'login needed' { 'Connecting' } default { 'Not set up' } })"
Write-Host " - OpenRouter: $(if ($openRouterStatus -eq 'configured') { 'Ready' } else { 'Not set up' })"
Write-Host " - Local OpenAI-compatible: $(if (Get-EnvValue 'MEDIA_LOCAL_OPENAI_BASE_URL') { 'Connecting' } else { 'Not set up' })"
Write-Host " - Local OpenAI base URL: $(Get-EnvValue 'MEDIA_LOCAL_OPENAI_BASE_URL')"
Write-Host ""
Write-Host "Next commands"
$summaryWebPort = Get-EnvValue "MEDIA_STUDIO_WEB_PORT"
if (-not $summaryWebPort) {
  $summaryWebPort = "3000"
}
Write-Host " - Studio: powershell -ExecutionPolicy Bypass -File .\scripts\run_studio.ps1"
Write-Host " - Stop later: powershell -ExecutionPolicy Bypass -File .\scripts\stop_studio.ps1"
Write-Host " - Configured setup page if the web port is free: http://127.0.0.1:$summaryWebPort/setup"
Write-Host " - Configured AI settings if the web port is free: http://127.0.0.1:$summaryWebPort/settings/llms"
Write-Host " - Actual launch URL: printed by the launcher after it checks for free API and web ports"
Write-Host "If ports 8000 or 3000 are busy, startup automatically selects temporary open ports for that launch."
Write-Host ""

$launchNow = Read-Host "Open Media Studio in a new PowerShell window now with automatic port selection? [y/N]"
if ($launchNow -match '^[Yy]$') {
  Start-DevWindow "powershell -ExecutionPolicy Bypass -File .\scripts\run_studio.ps1"
  Write-Host "Opening one PowerShell window for the API and web app. The launcher will print the actual Studio URL."
}
