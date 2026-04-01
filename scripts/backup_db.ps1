$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $ScriptDir "with_shared_python.ps1") (Join-Path $ScriptDir "backup_db.py") @args
