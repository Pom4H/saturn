$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class SaturnVideoWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
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
Start-Sleep -Milliseconds 800

$rect = New-Object SaturnVideoWindow+RECT
if (-not [SaturnVideoWindow]::GetWindowRect($proc.MainWindowHandle, [ref]$rect)) { throw 'GetWindowRect failed.' }
$sourceWidth = [Math]::Max(1, $rect.Right - $rect.Left)
$sourceHeight = [Math]::Max(1, $rect.Bottom - $rect.Top)
$targetWidth = [Math]::Min(1280, $sourceWidth)
$targetHeight = [int][Math]::Floor($sourceHeight * $targetWidth / $sourceWidth)
if ($targetHeight % 2 -ne 0) { $targetHeight-- }

$outDir = Join-Path (Get-Location) 'vscode-video'
$frames = Join-Path $outDir 'frames'
Remove-Item -Recurse -Force $outDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $frames | Out-Null

$fps = 8
$durationSeconds = 50
$totalFrames = $fps * $durationSeconds
$periodMs = [int](1000 / $fps)
$watch = [System.Diagnostics.Stopwatch]::StartNew()

Write-Host "Capturing $totalFrames real VS Code window frames with PrintWindow..."
for ($i=0; $i -lt $totalFrames; $i++) {
  $source = New-Object System.Drawing.Bitmap $sourceWidth, $sourceHeight
  $graphics = [System.Drawing.Graphics]::FromImage($source)
  $hdc = $graphics.GetHdc()
  $ok = [SaturnVideoWindow]::PrintWindow($proc.MainWindowHandle, $hdc, 2)
  $graphics.ReleaseHdc($hdc)
  $graphics.Dispose()
  if (-not $ok) {
    $source.Dispose()
    throw "PrintWindow failed at frame $i"
  }

  $target = New-Object System.Drawing.Bitmap $targetWidth, $targetHeight
  $scaled = [System.Drawing.Graphics]::FromImage($target)
  $scaled.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $scaled.DrawImage($source, 0, 0, $targetWidth, $targetHeight)
  $scaled.Dispose()
  $source.Dispose()

  $path = Join-Path $frames ('frame_{0:D4}.jpg' -f $i)
  $target.Save($path, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  $target.Dispose()

  $targetMs = ($i + 1) * $periodMs
  $remaining = $targetMs - $watch.ElapsedMilliseconds
  if ($remaining -gt 0) { Start-Sleep -Milliseconds $remaining }
}
$watch.Stop()

$sampleIndexes = @(0, [int]($totalFrames*.2), [int]($totalFrames*.4), [int]($totalFrames*.6), [int]($totalFrames*.8), $totalFrames-1)
$hashes = @()
foreach ($index in $sampleIndexes) {
  $hashes += (Get-FileHash (Join-Path $frames ('frame_{0:D4}.jpg' -f $index)) -Algorithm SHA256).Hash
}
if (($hashes | Sort-Object -Unique).Count -lt 3) { throw 'Captured tour is effectively static.' }

$ffmpegCommand = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
if (-not $ffmpegCommand) { $ffmpegCommand = Get-Command ffmpeg -ErrorAction SilentlyContinue }
if (-not $ffmpegCommand) { throw 'ffmpeg is required on the Windows runner.' }
$ffmpeg = $ffmpegCommand.Source
$out = Join-Path $outDir 'saturn-vscode-tour.mp4'
& $ffmpeg -hide_banner -loglevel warning -y -framerate $fps -i (Join-Path $frames 'frame_%04d.jpg') -c:v mpeg4 -q:v 4 -pix_fmt yuv420p -movflags +faststart $out
if ($LASTEXITCODE -ne 0) { throw "ffmpeg encoding failed with exit code $LASTEXITCODE" }

$info = Get-Item $out
if ($info.Length -lt 500000) { throw "Video is unexpectedly small: $($info.Length) bytes" }
Write-Host "Recorded Saturn VS Code tour: $out ($($info.Length) bytes)"

Remove-Item -Recurse -Force $frames
Get-Process Code -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
