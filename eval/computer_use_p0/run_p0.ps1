# One command for a non-technical Windows tester.
# Writes reports\p0_windows_<date>.csv and reports\p0_windows_<date>_summary.md
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
  Write-Host "Then run this same file again: .\run_p0.ps1"
  exit 1
}

if (-not (Test-Path (Join-Path $PSScriptRoot "config.local.json"))) {
  Write-Host "Copy config.example.json to config.local.json and set TEST_CONTACT to your test WhatsApp chat name."
  exit 1
}

& $py -c "import websockets" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Installing Python package: websockets"
  & $py -m pip install --user websockets
}

& $py "$PSScriptRoot\run_p0.py" @args
exit $LASTEXITCODE
