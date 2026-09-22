$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

New-Item -ItemType Directory -Force issue29-evidence | Out-Null
$emu = Get-ChildItem $env:SDK_DIR -File -Recurse -Filter SatPlcImit.exe | Select-Object -First 1 -ExpandProperty FullName
if (-not $emu) { throw 'SatPlcImit.exe not found in extracted official SDK' }
$binary = (Resolve-Path issue29-generated\main.bin).Path
$config = Get-ChildItem $env:SDK_DIR -Directory -Recurse -Filter .vscode |
  Where-Object { $_.FullName -match '\\template\\\.vscode$' } |
  Select-Object -First 1 -ExpandProperty FullName
if (-not $config) { throw 'SatSDK template .vscode directory not found' }

$proc = Start-Process -FilePath $emu -ArgumentList @('-b"' + $binary + '"','-c"' + $config + '"') -PassThru
try {
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  while ($proc.MainWindowHandle -eq 0 -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 250
    $proc.Refresh()
    if ($proc.HasExited) { throw "SatPlcImit exited early with $($proc.ExitCode)" }
  }
  if ($proc.MainWindowHandle -eq 0) { throw 'SatPlcImit did not create a main window' }

  $root = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $lines = New-Object System.Collections.Generic.List[string]
  function Walk-Ui([System.Windows.Automation.AutomationElement]$node,[int]$depth) {
    if ($depth -gt 8 -or $null -eq $node) { return }
    try {
      $r = $node.Current.BoundingRectangle
      $lines.Add(("{0}{1} | {2} | auto={3} | x={4} y={5} w={6} h={7}" -f ('  '*$depth),$node.Current.Name,$node.Current.ControlType.ProgrammaticName,$node.Current.AutomationId,[int]$r.X,[int]$r.Y,[int]$r.Width,[int]$r.Height))
    } catch {}
    $child = $walker.GetFirstChild($node)
    while ($null -ne $child) {
      Walk-Ui $child ($depth+1)
      $child = $walker.GetNextSibling($child)
    }
  }
  Walk-Ui $root 0
  $lines | Out-File issue29-evidence\emulator-ui.txt -Encoding utf8

  [System.Windows.Forms.SendKeys]::SendWait('{F9}')
  Start-Sleep -Seconds 2

  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $bounds.Width,$bounds.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bmp)
  try { $graphics.CopyFromScreen($bounds.Location,[System.Drawing.Point]::Empty,$bounds.Size) }
  finally { $graphics.Dispose() }
  $bmp.Save((Join-Path $PWD 'issue29-evidence\emulator-desktop.png'),[System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()

  $window = $root.Current.BoundingRectangle
  if ($window.Width -gt 20 -and $window.Height -gt 20) {
    $shot = New-Object System.Drawing.Bitmap ([int]$window.Width),([int]$window.Height)
    $g = [System.Drawing.Graphics]::FromImage($shot)
    try { $g.CopyFromScreen(([int]$window.X),([int]$window.Y),0,0,$shot.Size) }
    finally { $g.Dispose() }
    $shot.Save((Join-Path $PWD 'issue29-evidence\emulator-window.png'),[System.Drawing.Imaging.ImageFormat]::Png)
    $shot.Dispose()
  }

  "EXE=$emu" | Out-File issue29-evidence\emulator.txt -Encoding utf8
  "BINARY=$binary" | Out-File issue29-evidence\emulator.txt -Encoding utf8 -Append
  "BINARY_SHA256=$((Get-FileHash $binary -Algorithm SHA256).Hash)" | Out-File issue29-evidence\emulator.txt -Encoding utf8 -Append
  "WINDOW=$($root.Current.Name)" | Out-File issue29-evidence\emulator.txt -Encoding utf8 -Append
} finally {
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
}
