# Clear the front LibreOffice Calc sheet (Select All + Delete). P0 evaluator only.
$ErrorActionPreference = "Continue"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms
$root = [System.Windows.Automation.AutomationElement]::RootElement
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$target = $null
foreach ($w in $all) {
  $n = ""
  try { $n = $w.Current.Name } catch {}
  if ($n -match "LibreOffice|Calc") { $target = $w; break }
}
if ($null -eq $target) {
  Write-Output "calc_window_missing"
  exit 0
}
try { $target.SetFocus() } catch {}
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait("^a")
Start-Sleep -Milliseconds 120
[System.Windows.Forms.SendKeys]::SendWait("{DEL}")
Write-Output "calc_reset_select_all_delete"
