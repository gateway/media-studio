param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$RemainingArgs
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& powershell -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "stop_studio_windows.ps1") @RemainingArgs
exit $LASTEXITCODE
