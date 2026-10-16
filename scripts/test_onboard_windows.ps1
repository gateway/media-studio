$ErrorActionPreference = "Stop"
# Keep native nonzero exits non-terminating so the onboarding checks are exercised.
$PSNativeCommandUseErrorActionPreference = $false
$OnboardScript = Join-Path $PSScriptRoot "onboard_windows.ps1"
$NativeHost = (Get-Process -Id $PID).Path
$ExpectedSteps = @("clone", "runtime", "npm", "schema", "defaults")

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

# All filesystem, configuration, input and launch effects stay in memory. The only
# child process is this PowerShell executable returning a chosen native exit code.
function Invoke-OnboardingScenario {
  param([string]$FailStep = "")
  $state = @{
    FailStep = $FailStep
    Steps = [System.Collections.Generic.List[string]]::new()
    Output = [System.Collections.Generic.List[string]]::new()
    CheckoutReady = $false
    VenvReady = $false
    LocationDepth = 0
    Launched = $false
    EnvLines = @(
      "MEDIA_STUDIO_INSTALL_ID=test-install",
      "MEDIA_STUDIO_DB_PATH=unused-test-path",
      "MEDIA_STUDIO_DATA_ROOT=unused-test-root",
      "KIE_API_KEY=test-existing-value",
      "MEDIA_ENABLE_LIVE_SUBMIT=false",
      "USER_SETTING=keep-me"
    )
  }

  function Invoke-TestNative {
    param([string]$Step)
    $state.Steps.Add($Step)
    $code = if ($state.FailStep -eq $Step) { 23 } else { 0 }
    & $NativeHost -NoProfile -NonInteractive -Command "exit $code"
    $global:LASTEXITCODE = $LASTEXITCODE
    if ($LASTEXITCODE -eq 0) {
      if ($Step -eq "clone") { $state.CheckoutReady = $true }
      if ($Step -eq "runtime") { $state.VenvReady = $true }
    }
  }

  function Join-Path {
    param([string]$Path, [string]$ChildPath)
    if ($ChildPath -eq ".venv\Scripts\python.exe") { return "onboarding-test-python" }
    Microsoft.PowerShell.Management\Join-Path $Path $ChildPath
  }
  function Test-Path {
    param([string]$Path)
    if ($Path -eq "onboarding-test-python") { return $state.VenvReady }
    if ($Path -match '(\.git|pyproject\.toml)$') { return $state.CheckoutReady }
    return $true
  }
  function Get-Command { param([string]$Name, $ErrorAction) return @{ Name = $Name } }
  function Get-Content {
    param([string]$Path)
    if (-not $Path.EndsWith(".env")) { throw "Unexpected file read: $Path" }
    return $state.EnvLines
  }
  function Set-Content {
    param([string]$Path, $Value)
    if (-not $Path.EndsWith(".env")) { throw "Unexpected file write: $Path" }
    $state.EnvLines = @($Value)
  }
  function New-Item { param($ItemType, [switch]$Force, $Path) }
  function Push-Location { param($Path) $state.LocationDepth++ }
  function Pop-Location { $state.LocationDepth-- }
  function Start-Process { param($FilePath, $ArgumentList) $state.Launched = $true }
  function Write-Host { param([string]$Object) $state.Output.Add($Object) }
  function Read-Host {
    param([string]$Prompt, [switch]$AsSecureString)
    if ($AsSecureString) { return [System.Security.SecureString]::new() }
    return "y"
  }
  function git { Invoke-TestNative "clone" }
  function python { throw "Onboarding must not invoke the user's Python" }
  function node { Invoke-TestNative "runtime" }
  function npm { Invoke-TestNative "npm" }
  function onboarding-test-python {
    $null = @($input)
    if ($args[0] -eq "-") { Invoke-TestNative "schema" }
    else { Invoke-TestNative "defaults" }
  }

  $failure = $null
  try { & $OnboardScript } catch { $failure = $_ }
  if ($FailStep) {
    Assert-True ($null -ne $failure) "Onboarding continued after $FailStep failed."
    Assert-True ($failure.ToString() -match 'exit code 23') "Failure did not identify the native exit code: $failure"
    $lastIndex = [array]::IndexOf($ExpectedSteps, $FailStep)
    Assert-True (($state.Steps -join ',') -eq ($ExpectedSteps[0..$lastIndex] -join ',')) "Commands continued after $FailStep failed."
    Assert-True (-not ($state.Output -contains "Current setup summary")) "Failed setup printed readiness summary."
    Assert-True (-not $state.Launched) "Failed setup launched the app."
    Assert-True ($state.LocationDepth -eq 0) "Failed npm install left the location stack changed."
    # Retry the same in-memory installation after its native failure is corrected.
    $state.FailStep = ""
    & $OnboardScript
  } else {
    Assert-True ($null -eq $failure) "Successful onboarding failed: $failure"
    Assert-True (($state.Steps -join ',') -eq ($ExpectedSteps -join ',')) "A native prerequisite was skipped."
  }
  Assert-True ($state.Output -contains "Current setup summary") "Successful setup omitted summary."
  Assert-True $state.Launched "Successful setup did not offer launch."
  Assert-True ($state.LocationDepth -eq 0) "Location stack was not restored."
  Assert-True ($state.EnvLines -contains "USER_SETTING=keep-me") "Existing configuration was lost."
  Assert-True ($state.EnvLines -contains "KIE_API_KEY=test-existing-value") "Existing key was changed."
}

$savedEnvironment = @{}
foreach ($name in @("MEDIA_STUDIO_DB_PATH", "MEDIA_STUDIO_DATA_ROOT", "MEDIA_STUDIO_KIE_API_REPO_PATH")) {
  $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}
$savedExitCode = $global:LASTEXITCODE
$failures = [System.Collections.Generic.List[string]]::new()
try {
  foreach ($step in @("success") + $ExpectedSteps) {
    try {
      if ($step -eq "success") { Invoke-OnboardingScenario } else { Invoke-OnboardingScenario $step }
      Write-Host "PASS: $step"
    } catch {
      $failures.Add("${step}: $_")
      Write-Host "FAIL: ${step}: $_"
    }
  }
} finally {
  foreach ($name in $savedEnvironment.Keys) {
    [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], "Process")
  }
  $global:LASTEXITCODE = $savedExitCode
}
if ($failures.Count) { throw "$($failures.Count) Windows onboarding scenarios failed." }
Write-Host "All 6 onboarding scenarios passed; native failures, successful retries and existing configuration verified."
