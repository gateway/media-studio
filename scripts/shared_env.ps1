$ErrorActionPreference = "Stop"

function Get-MediaRootFromScript {
  param([string]$ScriptPath)

  $scriptDir = Split-Path -Parent $ScriptPath
  return (Resolve-Path (Join-Path $scriptDir "..")).Path
}

function Get-KieRoot {
  param([string]$MediaRoot)

  $parentRoot = Split-Path $MediaRoot -Parent
  $defaultKieRoot = Join-Path $parentRoot "kie-api"
  $legacyKieRoot = Join-Path (Join-Path $parentRoot "kie-ai") "kie_codex_bootstrap"

  if ($env:KIE_ROOT) {
    return $env:KIE_ROOT
  }
  if ($env:MEDIA_STUDIO_KIE_API_REPO_PATH) {
    return $env:MEDIA_STUDIO_KIE_API_REPO_PATH
  }
  if (Test-Path $defaultKieRoot) {
    return $defaultKieRoot
  }
  if (Test-Path $legacyKieRoot) {
    return $legacyKieRoot
  }
  return $defaultKieRoot
}
