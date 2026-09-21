$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeWindow {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@

$root = Join-Path $env:RUNNER_TEMP 'saturn-vscode'
$codeZip = Join-Path $root 'vscode.zip'
$downloadedCodeRoot = Join-Path $root 'code'
$userData = Join-Path $root 'user-data'
$extensions = Join-Path $root 'extensions'
$extensionTarget = Join-Path $extensions 'saturn.saturn-vscode-0.1.0'
New-Item -ItemType Directory -Force -Path $root,$downloadedCodeRoot | Out-Null
Remove-Item -Recurse -Force $userData,$extensions -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $userData,$extensions,$extensionTarget | Out-Null

$candidates = @(
  (Join-Path $downloadedCodeRoot 'Code.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\Code.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft VS Code\Code.exe')
)
if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} 'Microsoft VS Code\Code.exe') }
$code = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $code) {
  $codeCommand = Get-Command code.cmd -ErrorAction SilentlyContinue
  if (-not $codeCommand) { $codeCommand = Get-Command code -ErrorAction SilentlyContinue }
  if ($codeCommand) {
    $commandPath = $codeCommand.Source
    if ($commandPath.ToLowerInvariant().EndsWith('.cmd')) {
      $candidate = Join-Path (Split-Path (Split-Path $commandPath -Parent) -Parent) 'Code.exe'
      if (Test-Path $candidate) { $code = $candidate }
    } elseif ($commandPath.ToLowerInvariant().EndsWith('code.exe')) {
      $code = $commandPath
    }
  }
}
if (-not $code) {
  Write-Host 'Installed VS Code not found; downloading official stable archive with curl.'
  & curl.exe -L --fail --retry 2 'https://update.code.visualstudio.com/latest/win32-x64-archive/stable' -o $codeZip
  if ($LASTEXITCODE -ne 0) { throw "VS Code download failed with exit code $LASTEXITCODE" }
  Expand-Archive -Path $codeZip -DestinationPath $downloadedCodeRoot -Force
  $code = Join-Path $downloadedCodeRoot 'Code.exe'
} else {
  Write-Host "Using installed VS Code: $code"
}
Copy-Item -Recurse -Force 'vscode\*' $extensionTarget

$settingsDir = Join-Path $userData 'User'
New-Item -ItemType Directory -Force -Path $settingsDir | Out-Null
$saturnExe = (Join-Path $env:RUNNER_TEMP 'saturn.exe').Replace('\','\\')
@"
{
  "security.workspace.trust.enabled": false,
  "workbench.startupEditor": "none",
  "chat.disableAIFeatures": true,
  "workbench.colorTheme": "Default Dark Modern",
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  "workbench.activityBar.location": "default",
  "workbench.sideBar.location": "left",
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  "window.restoreWindows": "none",
  "window.commandCenter": false,
  "saturn.cli.path": "$saturnExe",
  "saturn.project.entry": "plant.ts"
}
"@ | Set-Content -Encoding UTF8 (Join-Path $settingsDir 'settings.json')

@"
[
  { "key": "ctrl+alt+s", "command": "workbench.view.extension.saturn" },
  { "key": "ctrl+alt+d", "command": "saturn.openDiagram" }
]
"@ | Set-Content -Encoding UTF8 (Join-Path $settingsDir 'keybindings.json')

$workspace = (Resolve-Path 'plant\demo').Path
$file = (Resolve-Path 'plant\demo\plant.ts').Path
$args = @(
  '--user-data-dir', $userData,
  '--extensions-dir', $extensions,
  '--disable-updates',
  '--disable-workspace-trust',
  '--new-window',
  $workspace,
  $file
)
$env:SATURN_VSCODE_CAPTURE = '1'
Start-Process -FilePath $code -ArgumentList $args | Out-Null

$proc = $null
for ($i=0; $i -lt 90; $i++) {
  Start-Sleep -Milliseconds 500
  $proc = Get-Process Code -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object StartTime -Descending | Select-Object -First 1
  if ($proc) { break }
}
if (-not $proc) { throw 'VS Code did not create a visible window on the runner.' }

[NativeWindow]::ShowWindow($proc.MainWindowHandle, 3) | Out-Null
Start-Sleep -Seconds 12

$rect = New-Object NativeWindow+RECT
if (-not [NativeWindow]::GetWindowRect($proc.MainWindowHandle, [ref]$rect)) { throw 'GetWindowRect failed.' }
$width = [Math]::Max(1, $rect.Right - $rect.Left)
$height = [Math]::Max(1, $rect.Bottom - $rect.Top)
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$hdc = $graphics.GetHdc()
$printed = [NativeWindow]::PrintWindow($proc.MainWindowHandle, $hdc, 2)
$graphics.ReleaseHdc($hdc)
$graphics.Dispose()

if (-not $printed) {
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size $width,$height))
  $graphics.Dispose()
}

New-Item -ItemType Directory -Force -Path 'vscode-screenshot' | Out-Null
$out = (Resolve-Path 'vscode-screenshot').Path + '\saturn-vscode-installed.png'
$bitmap.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()

$manifestPath = Join-Path $extensionTarget 'package.json'
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$installedId = "$($manifest.publisher).$($manifest.name)@$($manifest.version)"
$installedId | Set-Content -Encoding UTF8 'vscode-screenshot\installed-extensions.txt'
if ($installedId -ne 'saturn.saturn-vscode@0.1.0') { throw "Unexpected installed extension identity: $installedId" }

$size = (Get-Item $out).Length
if ($size -lt 10000) { throw "Screenshot is unexpectedly small: $size bytes" }
Write-Host "Captured real VS Code window: $out ($size bytes)"
Get-Process Code -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
