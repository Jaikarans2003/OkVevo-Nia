# Sync/bind this checkout's Python into the installed Nia.exe process.
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
function Find-Python {
  if ($env:P0_PYTHON -and (Test-Path $env:P0_PYTHON)) { return $env:P0_PYTHON }
  $venv = Join-Path $env:USERPROFILE ".hermes\hermes-agent\venv\Scripts\python.exe"
  if (Test-Path $venv) { return $venv }
  foreach ($name in @("python", "python3", "py")) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
  }
  return $null
}
$py = Find-Python
if (-not $py) {
  Write-Host "Python is missing. Install from https://www.python.org/downloads/ and tick Add python.exe to PATH."
  exit 1
}
& $py "$PSScriptRoot\live_agent.py" bind
exit $LASTEXITCODE
