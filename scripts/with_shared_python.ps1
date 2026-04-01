$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$MediaRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
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
  $KieRoot = $LegacyKieRoot
}

$VenvPy = Join-Path $KieRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $VenvPy)) {
  throw "Shared Media Studio Python runtime not found at $VenvPy. Run onboarding first."
}

& $VenvPy @args
