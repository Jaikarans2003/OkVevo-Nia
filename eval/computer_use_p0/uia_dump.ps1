# Dump UIA trees for P0 (WhatsApp, Notes, TallyPrime, LibreOffice Calc).
# Usage: powershell -File uia_dump.ps1 -App WhatsApp
param(
    [string]$App = "WhatsApp",
    [int]$MaxNodes = 400
)

function Get-UiaRoot {
    Add-Type -AssemblyName UIAutomationClient -ErrorAction SilentlyContinue
    return [System.Windows.Automation.AutomationElement]::RootElement
}

function Walk([System.Windows.Automation.AutomationElement]$el, [int]$depth, [ref]$count) {
    if ($null -eq $el) { return }
    if ($count.Value -ge $MaxNodes) { return }
    $count.Value++
    $name = ""
    $autoId = ""
    $role = ""
    try { $name = $el.Current.Name } catch {}
    try { $autoId = $el.Current.AutomationId } catch {}
    try { $role = $el.Current.ControlType.ProgrammaticName } catch {}
    $rect = $null
    try { $rect = $el.Current.BoundingRectangle } catch {}
    $bounds = ""
    if ($null -ne $rect) {
        $bounds = "{0},{1},{2},{3}" -f [int]$rect.X, [int]$rect.Y, [int]$rect.Width, [int]$rect.Height
    }
    ("  " * $depth) + ("role={0} name={1} automationId={2} bounds={3}" -f $role, $name, $autoId, $bounds)
    $cond = [System.Windows.Automation.Condition]::TrueCondition
    try {
        $kids = $el.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
        foreach ($k in $kids) { Walk $k ($depth + 1) $count }
    } catch {}
}

$root = Get-UiaRoot
if ($null -eq $root) { Write-Output "UIA_ROOT_MISSING"; exit 1 }

$target = $null
# Prefer a window whose process name or title matches.
$procHits = @()
try {
  $procHits = @(Get-Process | Where-Object { $_.ProcessName -match [regex]::Escape($App) -or $_.MainWindowTitle -match [regex]::Escape($App) })
} catch {}
foreach ($proc in $procHits) {
  try {
    $cond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$proc.Id
    )
    $hit = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
    if ($null -ne $hit) { $target = $hit; break }
  } catch {}
}

$all = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
if ($null -eq $target) {
  foreach ($w in $all) {
    $n = ""
    try { $n = $w.Current.Name } catch {}
    $p = ""
    try { $p = $w.Current.ClassName } catch {}
    if ($n -match [regex]::Escape($App) -or $p -match [regex]::Escape($App)) {
      $target = $w
      break
    }
  }
}
if ($null -eq $target) {
  Write-Output ("NO_WINDOW_MATCH app=" + $App)
  foreach ($w in $all) {
    $n = ""
    try { $n = $w.Current.Name } catch {}
    if ($n) { Write-Output ("window name=" + $n) }
  }
  exit 2
}
$count = 0
Walk $target 0 ([ref]$count)
