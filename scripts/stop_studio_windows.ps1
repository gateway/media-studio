param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$RemainingArgs
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$MediaRoot = Split-Path -Parent $ScriptDir

Set-Location $MediaRoot
& node (Join-Path $ScriptDir "stop_studio.mjs") @RemainingArgs
exit $LASTEXITCODE
