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

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32Saturn {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int maxCount);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extraInfo);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

function Find-DesktopButton([string[]]$names) {
  $desktop = [System.Windows.Automation.AutomationElement]::RootElement
  foreach ($name in $names) {
    $condition = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty),$name
    $button = $desktop.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)
    if ($null -ne $button) { return $button }
  }
  return $null
}

function Invoke-AutomationButton($button) {
  try {
    $pattern = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $pattern.Invoke()
    return $true
  } catch { return $false }
}

function Click-Point([int]$x,[int]$y) {
  [Win32Saturn]::SetCursorPos($x,$y) | Out-Null
  Start-Sleep -Milliseconds 100
  [Win32Saturn]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero)
  [Win32Saturn]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)
}

function Capture-Window([IntPtr]$handle,[string]$file) {
  $rect = New-Object Win32Saturn+RECT
  if (-not [Win32Saturn]::GetWindowRect($handle,[ref]$rect)) { throw "GetWindowRect failed: $handle" }
  $width=$rect.Right-$rect.Left; $height=$rect.Bottom-$rect.Top
  if ($width -lt 20 -or $height -lt 20) { throw "Window too small: $width x $height" }
  $shot = New-Object System.Drawing.Bitmap $width,$height
  $g = [System.Drawing.Graphics]::FromImage($shot)
  try { $g.CopyFromScreen($rect.Left,$rect.Top,0,0,$shot.Size) }
  finally { $g.Dispose() }
  $shot.Save((Join-Path $PWD $file),[System.Drawing.Imaging.ImageFormat]::Png)
  $shot.Dispose()
}

$proc = Start-Process -FilePath $emu -ArgumentList @('-b"' + $binary + '"','-c"' + $config + '"') -PassThru
try {
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  while ($proc.MainWindowHandle -eq 0 -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 250
    $proc.Refresh()
    if ($proc.HasExited) { throw "SatPlcImit exited early with $($proc.ExitCode)" }
  }
  if ($proc.MainWindowHandle -eq 0) { throw 'SatPlcImit did not create a main window' }

  # The emulator opens a listening socket and Windows can display a firewall
  # consent dialog on a fresh runner. Network access is not needed for this test:
  # explicitly dismiss it instead of accidentally capturing it as HMI evidence.
  Start-Sleep -Seconds 1
  $cancelRu = -join ([char[]](0x41e,0x442,0x43c,0x435,0x43d,0x438,0x442,0x44c))
  # Escape maps to Cancel on the Windows Firewall consent dialog. If no
  # consent dialog is present it is harmless to the emulator main window.
  [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
  Start-Sleep -Milliseconds 500

  [Win32Saturn]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
  # Send F9 directly to SatPlcImit. SendKeys can fail with "Access is denied" on
  # self-hosted runners when Windows foreground/UIPI policy changes between runs.
  [Win32Saturn]::PostMessage($proc.MainWindowHandle,0x0100,[IntPtr]0x78,[IntPtr]::Zero) | Out-Null
  [Win32Saturn]::PostMessage($proc.MainWindowHandle,0x0101,[IntPtr]0x78,[IntPtr]::Zero) | Out-Null
  Start-Sleep -Seconds 1

  # SatPlcImit paints its toolbar as native/custom controls, so UI Automation
  # does not expose the emulator toolbar button. Click its stable relative toolbar slot.
  $mainRect = New-Object Win32Saturn+RECT
  [Win32Saturn]::GetWindowRect($proc.MainWindowHandle,[ref]$mainRect) | Out-Null
  $mainWidth=$mainRect.Right-$mainRect.Left
  $mainHeight=$mainRect.Bottom-$mainRect.Top
  Click-Point ($mainRect.Left + [int]($mainWidth*0.17)) ($mainRect.Top + [int]($mainHeight*0.09))
  Start-Sleep -Seconds 2

  # Enumerate every visible top-level window owned by SatPlcImit. A real
  # controller-emulator/HMI window must exist in addition to the main IDE window.
  $windows = New-Object System.Collections.Generic.List[object]
  $callback = [Win32Saturn+EnumWindowsProc]{
    param([IntPtr]$h,[IntPtr]$l)
    $pidValue=0
    [Win32Saturn]::GetWindowThreadProcessId($h,[ref]$pidValue) | Out-Null
    if ($pidValue -eq $proc.Id -and [Win32Saturn]::IsWindowVisible($h)) {
      $sb=New-Object System.Text.StringBuilder 512
      [Win32Saturn]::GetWindowText($h,$sb,$sb.Capacity) | Out-Null
      $r=New-Object Win32Saturn+RECT
      [Win32Saturn]::GetWindowRect($h,[ref]$r) | Out-Null
      $windows.Add([pscustomobject]@{Handle=$h;Title=$sb.ToString();X=$r.Left;Y=$r.Top;Width=$r.Right-$r.Left;Height=$r.Bottom-$r.Top})
    }
    return $true
  }
  [Win32Saturn]::EnumWindows($callback,[IntPtr]::Zero) | Out-Null
  $windows | Sort-Object Width | Format-Table -AutoSize | Out-String -Width 400 | Out-File issue29-evidence\emulator-windows.txt -Encoding utf8
  if ($windows.Count -lt 2) { throw 'SatPlcImit HMI window did not open' }

  # The controller emulator title is localized by SatSDK. Identify the actual
  # child/top-level controller window structurally instead of depending on text.
  $hmi = $windows |
    Where-Object { $_.Handle -ne $proc.MainWindowHandle -and $_.Width -ge 320 -and $_.Height -ge 240 } |
    Sort-Object @{Expression={$_.Width*$_.Height};Descending=$true} |
    Select-Object -First 1
  if ($null -eq $hmi) { throw 'Plausible Saturn controller emulator window not found' }
  Capture-Window $hmi.Handle 'issue29-evidence\emulator-hmi.png'
  Capture-Window $proc.MainWindowHandle 'issue29-evidence\emulator-main.png'

  $root = [System.Windows.Automation.AutomationElement]::FromHandle($hmi.Handle)
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $lines = New-Object System.Collections.Generic.List[string]
  function Walk-Ui([System.Windows.Automation.AutomationElement]$node,[int]$depth) {
    if ($depth -gt 8 -or $null -eq $node) { return }
    try {
      $r = $node.Current.BoundingRectangle
      $lines.Add(("{0}{1} | {2} | auto={3} | x={4} y={5} w={6} h={7}" -f ('  '*$depth),$node.Current.Name,$node.Current.ControlType.ProgrammaticName,$node.Current.AutomationId,[int]$r.X,[int]$r.Y,[int]$r.Width,[int]$r.Height))
    } catch {}
    $child = $walker.GetFirstChild($node)
    while ($null -ne $child) { Walk-Ui $child ($depth+1); $child = $walker.GetNextSibling($child) }
  }
  Walk-Ui $root 0
  $lines | Out-File issue29-evidence\emulator-ui.txt -Encoding utf8

  "EXE=$emu" | Out-File issue29-evidence\emulator.txt -Encoding utf8
  "BINARY=$binary" | Out-File issue29-evidence\emulator.txt -Encoding utf8 -Append
  "BINARY_SHA256=$((Get-FileHash $binary -Algorithm SHA256).Hash)" | Out-File issue29-evidence\emulator.txt -Encoding utf8 -Append
  "MAIN_WINDOW=$($proc.MainWindowTitle)" | Out-File issue29-evidence\emulator.txt -Encoding utf8 -Append
  "HMI_WINDOW=$($hmi.Title)" | Out-File issue29-evidence\emulator.txt -Encoding utf8 -Append
} finally {
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
}
