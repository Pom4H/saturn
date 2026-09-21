$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class SaturnVideoWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
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

$workspace = Join-Path $root 'workspace'
Remove-Item -Recurse -Force $workspace -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $workspace | Out-Null
@'
import { project, system, simulation, derived, alarm } from '@saturn/core';

const main = system('main', 'Cooling loop');

const grid = simulation('GRID', 'supply', {
  system: 'main',
  at: { x: 80, y: 100 },
  parameters: { voltage: 1 },
});

const pump = simulation('P-101', 'pump', {
  system: 'main',
  at: { x: 300, y: 100 },
  inputs: { voltage: grid.voltage },
  parameters: { inertia: 4, nominalFlow: 1.2 },
});

const tank = simulation('T-101', 'reservoir', {
  system: 'main',
  at: { x: 520, y: 100 },
  inputs: { inflow: pump.flow, demand: 0.45 },
  parameters: { capacity: 12, initialLevel: 0.7 },
});

const valve = simulation('V-101', 'motor-valve', {
  system: 'main',
  at: { x: 740, y: 100 },
  inputs: { demand: 0.65, pressure: 1 },
});

const exchanger = simulation('HX-101', 'heat-exchanger', {
  system: 'main',
  at: { x: 960, y: 100 },
  inputs: { heat: pump.power, cooling: 1 },
});

const flow = derived('loop.flow', pump.flow, 'm3/h');
const flowHigh = alarm('flow-high', {
  title: 'High flow',
  signal: pump.flow,
  above: 1.15,
  clearBelow: 1.05,
  priority: 'warning',
});

export default project('vscode-demo', {
  title: 'Saturn VS Code · Cooling loop',
  description: 'Small valid project used to demonstrate the native Saturn VS Code host.',
  systems: [main],
  simulations: [grid, pump, tank, valve, exchanger],
  signals: [flow],
  alarms: [flowHigh],
  reports: [],
  overview: [
    { signal: 'P-101.rpm', label: 'Pump speed', unit: 'rpm' },
    { signal: 'T-101.level', label: 'Tank level', unit: '%' },
    { signal: 'V-101.opening', label: 'Valve', unit: '%' },
  ],
});
'@ | Set-Content -Encoding UTF8 (Join-Path $workspace 'plant.ts')

$manifestJson = @'
{
  "version": 1,
  "entry": "plant.ts",
  "files": ["plant.ts"]
}
'@
[System.IO.File]::WriteAllText(
  (Join-Path $workspace 'scada.project.json'),
  $manifestJson,
  (New-Object System.Text.UTF8Encoding($false))
)

$file = Join-Path $workspace 'plant.ts'

$diagramJson = & (Join-Path $env:RUNNER_TEMP 'saturn.exe') ide diagram --project $workspace --json
if ($LASTEXITCODE -ne 0) { throw "Saturn demo workspace did not compile for Diagram" }
$diagram = $diagramJson | ConvertFrom-Json
if ($diagram.schema -ne 1 -or $diagram.scene.nodes.Count -lt 5) {
  throw "Saturn Diagram smoke test returned an incomplete scene"
}
Write-Host "Validated Saturn Diagram scene with $($diagram.scene.nodes.Count) equipment nodes."

$args = @(
  '--user-data-dir', $userData,
  '--extensions-dir', $extensions,
  '--disable-updates',
  '--disable-workspace-trust',
  '--remote-debugging-port=9222',
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

$outDir = Join-Path (Get-Location) 'vscode-video'
$frames = Join-Path $outDir 'frames'
Remove-Item -Recurse -Force $outDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $frames | Out-Null

$env:VSCODE_CDP = 'http://127.0.0.1:9222'
$env:VSCODE_FRAME_DIR = $frames
$env:VSCODE_CAPTURE_SECONDS = '50'
& node scripts\vscode-capture-screencast.mjs
if ($LASTEXITCODE -ne 0) { throw "VS Code compositor capture failed with exit code $LASTEXITCODE" }

$captured = @(Get-ChildItem $frames -Filter 'frame_*.jpg' | Sort-Object Name)
if ($captured.Count -lt 8) { throw "Expected at least 8 composited frames, got $($captured.Count)" }
$sampleIndexes = @(0, [int][Math]::Floor($captured.Count * 0.25), [int][Math]::Floor($captured.Count * 0.5), [int][Math]::Floor($captured.Count * 0.75), ($captured.Count - 1))
$hashes = @()
foreach ($index in $sampleIndexes) {
  $hashes += (Get-FileHash $captured[$index].FullName -Algorithm SHA256).Hash
}
if (($hashes | Sort-Object -Unique).Count -lt 3) { throw 'Captured tour is effectively static.' }

$ffmpegCommand = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
if (-not $ffmpegCommand) { $ffmpegCommand = Get-Command ffmpeg -ErrorAction SilentlyContinue }
if (-not $ffmpegCommand) { throw 'ffmpeg is required on the Windows runner.' }
$ffmpeg = $ffmpegCommand.Source
$out = Join-Path $outDir 'saturn-vscode-tour.mp4'
$concat = Join-Path $frames 'concat.txt'
& $ffmpeg -hide_banner -loglevel warning -y -f concat -safe 0 -i $concat -vf "fps=15,scale=1280:-2" -c:v mpeg4 -q:v 4 -pix_fmt yuv420p -movflags +faststart $out
if ($LASTEXITCODE -ne 0) { throw "ffmpeg encoding failed with exit code $LASTEXITCODE" }

$info = Get-Item $out
if ($info.Length -lt 500000) { throw "Video is unexpectedly small: $($info.Length) bytes" }
Write-Host "Recorded Saturn VS Code tour: $out ($($info.Length) bytes, $($captured.Count) compositor frames)"

Remove-Item -Recurse -Force $frames
Get-Process Code -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
