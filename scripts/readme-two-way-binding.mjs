import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const port = 4197;
const origin = `http://127.0.0.1:${port}`;
const root = 'test-results/readme-two-way-binding';
const framesDir = join(root, 'frames');
const output = 'docs/assets/two-way-binding.gif';

await rm(root, { recursive: true, force: true });
await mkdir(framesDir, { recursive: true });
await mkdir('docs/assets', { recursive: true });

const server = spawn(process.execPath, ['scripts/site-dev.mjs'], {
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
server.stdout.on('data', chunk => serverOutput += chunk);
server.stderr.on('data', chunk => serverOutput += chunk);

let browser;
try {
  for (let i = 0; i < 150; i++) {
    if (server.exitCode !== null) throw new Error(serverOutput);
    try {
      if ((await fetch(origin)).ok) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : { channel: 'chrome' }),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();

  await page.goto(origin + '/#workspace');
  await page.waitForFunction(() => document.body.classList.contains('shell-fullscreen'));
  await page.waitForSelector('#studio-svg [data-node="P-01"]');
  await page.locator('#studio-2d').click();
  await page.locator('#studio-fit').click();

  if (!(await page.locator('#studio-editor-pane').isVisible())) {
    await page.locator('#studio-code').click();
  }

  // Select the real pump and use the real source-navigation action so the
  // corresponding TypeScript literal is visible in CodeMirror.
  const pump = page.locator('#studio-svg [data-node="P-01"]');
  await pump.press('Enter');
  await page.locator('#object-source').click();
  if (await page.locator('#inspector-close').isVisible()) {
    await page.locator('#inspector-close').click();
  }
  await page.locator('#studio-fit').click();
  await page.waitForTimeout(250);

  const source = page.locator('#studio-editor .cm-content');
  const initialText = await source.innerText();
  assert.match(initialText, /x:\s*330,\s*y:\s*268/, 'Expected the real P-01 source coordinates');

  // Recording-only pointer overlay. The application underneath is untouched:
  // all equipment movement and TypeScript edits are Saturn's real interaction.
  await page.evaluate(() => {
    const cursor = document.createElement('div');
    cursor.id = 'readme-demo-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    cursor.innerHTML = `<svg width="28" height="34" viewBox="0 0 28 34" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 2L23 20H14L19 31L14.5 33L9.5 21.5L3 27V2Z" fill="#fff" stroke="#111827" stroke-width="2" stroke-linejoin="round"/>
    </svg>`;
    Object.assign(cursor.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      width: '28px',
      height: '34px',
      pointerEvents: 'none',
      zIndex: '2147483647',
      filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.28))',
      transform: 'translate(-3px,-2px)',
    });
    document.body.append(cursor);
  });

  const setCursor = async (x, y) => {
    await page.evaluate(([cx, cy]) => {
      const cursor = document.getElementById('readme-demo-cursor');
      if (cursor) {
        cursor.style.left = cx + 'px';
        cursor.style.top = cy + 'px';
      }
    }, [x, y]);
    await page.mouse.move(x, y);
  };

  let frameIndex = 0;
  const framePath = i => join(framesDir, String(i).padStart(4, '0') + '.png');
  const capture = async () => {
    await page.screenshot({ path: framePath(frameIndex++) });
  };
  const duplicateLast = async count => {
    const last = framePath(frameIndex - 1);
    for (let i = 0; i < count; i++) await copyFile(last, framePath(frameIndex++));
  };

  let box = await pump.boundingBox();
  if (!box) throw new Error('Pump has no rendered bounding box');
  let cursorX = box.x + box.width * 0.62;
  let cursorY = box.y + box.height * 0.72;
  await setCursor(cursorX, cursorY);
  await capture();
  await duplicateLast(6);

  // Small real drag gestures make each source update visible in the GIF while
  // preserving Saturn's existing one-undo-per-drag behavior.
  const forwardFrames = [];
  for (let step = 0; step < 14; step++) {
    box = await page.locator('#studio-svg [data-node="P-01"]').boundingBox();
    if (!box) throw new Error('Pump disappeared during drag capture');
    const fromX = box.x + box.width * 0.62;
    const fromY = box.y + box.height * 0.72;
    const toX = fromX + 8;
    const toY = fromY + (step % 2 === 0 ? 3 : 2);

    await setCursor(fromX, fromY);
    await page.mouse.down();
    await setCursor(toX, toY);
    await page.mouse.up();
    await page.waitForTimeout(35);

    const text = await source.innerText();
    assert(!/x:\s*330,\s*y:\s*268/.test(text), 'Source coordinates did not update after visual drag');

    cursorX = toX;
    cursorY = toY;
    await capture();
    forwardFrames.push(framePath(frameIndex - 1));
  }

  await duplicateLast(5);

  // Ping-pong only the already captured real UI frames to make the README GIF loop
  // without another mutation of the project.
  for (let i = forwardFrames.length - 2; i >= 0; i--) {
    await copyFile(forwardFrames[i], framePath(frameIndex++));
  }
  await copyFile(framePath(0), framePath(frameIndex++));
  await duplicateLast(5);

  const finalText = await source.innerText();
  assert.notEqual(finalText, initialText, 'The real TypeScript source must change');
  assert.equal(await page.locator('#studio-diagnostics').getAttribute('data-error'), 'false');

  await context.close();

  const ffmpeg = spawnSync('ffmpeg', [
    '-y',
    '-framerate', '10',
    '-i', join(framesDir, '%04d.png'),
    '-filter_complex',
    '[0:v]scale=1200:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
    '-loop', '0',
    output,
  ], { stdio: 'inherit' });
  if (ffmpeg.status !== 0) throw new Error(`ffmpeg failed with exit code ${ffmpeg.status}`);

  console.log(JSON.stringify({
    ok: true,
    source: 'real Saturn IDE render',
    interaction: 'real pointer drag -> source-preserving TypeScript edit',
    frames: frameIndex,
    gif: output,
  }));
} finally {
  await browser?.close().catch(() => {});
  server.kill('SIGTERM');
}
