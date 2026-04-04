$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$null = . (Join-Path $ScriptDir "shared_env.ps1")
$MediaRoot = Get-MediaRootFromScript $MyInvocation.MyCommand.Path
$KieRoot = Get-KieRoot $MediaRoot

$VenvPy = Join-Path $KieRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $VenvPy)) {
  throw "Shared Media Studio Python runtime not found at $VenvPy. Run onboarding first."
}

& $VenvPy @args
