$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class SaturnVideoWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@

$root = Join-Path $env:RUNNER_TEMP 'saturn-vscode-video'
$codeZip = Join-Path $root 'vscode.zip'
$codeRoot = Join-Path $root 'code'
$userData = Join-Path $root 'user-data'
$extensions = Join-Path $root 'extensions'
$extensionTarget = Join-Path $extensions 'saturn.saturn-vscode-0.1.0'
New-Item -ItemType Directory -Force -Path $root,$codeRoot | Out-Null
Remove-Item -Recurse -Force $userData,$extensions -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $userData,$extensions,$extensionTarget | Out-Null

$candidates = @(
  (Join-Path $codeRoot 'Code.exe'),
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
  Write-Host 'Downloading official VS Code stable archive.'
  & curl.exe -L --fail --retry 2 'https://update.code.visualstudio.com/latest/win32-x64-archive/stable' -o $codeZip
  if ($LASTEXITCODE -ne 0) { throw "VS Code download failed with exit code $LASTEXITCODE" }
  Expand-Archive -Path $codeZip -DestinationPath $codeRoot -Force
  $code = Join-Path $codeRoot 'Code.exe'
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
  "window.restoreWindows": "none",
  "window.commandCenter": false,
  "editor.fontSize": 15,
  "terminal.integrated.fontSize": 14,
  "saturn.cli.path": "$saturnExe",
  "saturn.project.entry": "plant.ts"
}
"@ | Set-Content -Encoding UTF8 (Join-Path $settingsDir 'settings.json')

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

$env:SATURN_VSCODE_TOUR = '1'
Remove-Item Env:SATURN_VSCODE_CAPTURE -ErrorAction SilentlyContinue
Start-Process -FilePath $code -ArgumentList $args | Out-Null

$proc = $null
for ($i=0; $i -lt 90; $i++) {
  Start-Sleep -Milliseconds 500
  $proc = Get-Process Code -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object StartTime -Descending | Select-Object -First 1
  if ($proc) { break }
}
if (-not $proc) { throw 'VS Code did not create a visible window.' }

[SaturnVideoWindow]::ShowWindow($proc.MainWindowHandle, 3) | Out-Null
[SaturnVideoWindow]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null

$ffmpeg = (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue)?.Source
if (-not $ffmpeg) { $ffmpeg = (Get-Command ffmpeg -ErrorAction SilentlyContinue)?.Source }
if (-not $ffmpeg) { throw 'ffmpeg is required on the Windows runner.' }

New-Item -ItemType Directory -Force -Path 'vscode-video' | Out-Null
$out = (Resolve-Path 'vscode-video').Path + '\saturn-vscode-tour.mp4'
Start-Sleep -Milliseconds 600
Write-Host "Recording real VS Code desktop with $ffmpeg"
& $ffmpeg -hide_banner -loglevel warning -y -f gdigrab -framerate 30 -draw_mouse 1 -i desktop -t 52 -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -preset veryfast -crf 22 -pix_fmt yuv420p -movflags +faststart $out
if ($LASTEXITCODE -ne 0) { throw "ffmpeg recording failed with exit code $LASTEXITCODE" }

$info = Get-Item $out
if ($info.Length -lt 500000) { throw "Video is unexpectedly small: $($info.Length) bytes" }
Write-Host "Recorded Saturn VS Code tour: $out ($($info.Length) bytes)"

Get-Process Code -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
