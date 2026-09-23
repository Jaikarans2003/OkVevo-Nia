# Best-effort: delete P0 "Test Ledger" in TallyPrime Educational Mode via UIA.
# Requires a Tally company already open. Does not type phone numbers.
$ErrorActionPreference = "Continue"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

$ledger = "Test Ledger"
$under = "Sundry Debtors"
$root = [System.Windows.Automation.AutomationElement]::RootElement
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$target = $null
foreach ($w in $all) {
  $n = ""
  try { $n = $w.Current.Name } catch {}
  if ($n -match "Tally|Gateway of Tally") { $target = $w; break }
}
if ($null -eq $target) {
  Write-Output "tally_window_missing"
  exit 0
}

function Find-Named($el, $needle, $depth) {
  if ($null -eq $el -or $depth -gt 14) { return $null }
  $n = ""
  try { $n = $el.Current.Name } catch {}
  if ($n -eq $needle) { return $el }
  $kids = $el.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($k in $kids) {
    $hit = Find-Named $k $needle ($depth + 1)
    if ($null -ne $hit) { return $hit }
  }
  return $null
}

$item = Find-Named $target $ledger 0
if ($null -eq $item) {
  Write-Output "tally_ledger_absent"
  exit 0
}
try { $item.SetFocus() } catch {}
Start-Sleep -Milliseconds 200
# Tally Educational Mode: Alt+D is Delete on many ledger screens.
[System.Windows.Forms.SendKeys]::SendWait("%d")
Start-Sleep -Milliseconds 400
[System.Windows.Forms.SendKeys]::SendWait("Y")
Start-Sleep -Milliseconds 400
$still = Find-Named $target $ledger 0
if ($null -eq $still) { Write-Output "tally_ledger_deleted" } else { Write-Output "tally_ledger_still_present" }
