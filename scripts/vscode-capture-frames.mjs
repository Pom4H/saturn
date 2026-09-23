import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const endpoint = process.env.VSCODE_CDP ?? 'http://127.0.0.1:9222';
const out = process.env.VSCODE_FRAME_DIR ?? 'vscode-video/frames';
const fps = Number(process.env.VSCODE_CAPTURE_FPS ?? 5);
const seconds = Number(process.env.VSCODE_CAPTURE_SECONDS ?? 50);
const total = Math.round(fps * seconds);

async function waitEndpoint() {
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(endpoint + '/json/version', { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('VS Code DevTools endpoint did not become available');
}

await mkdir(out, { recursive: true });
await waitEndpoint();

const browser = await chromium.connectOverCDP(endpoint);
const context = browser.contexts()[0];
if (!context) throw new Error('VS Code browser context not found');

let page;
for (let i = 0; i < 100; i++) {
  for (const candidate of context.pages()) {
    try {
      if (await candidate.locator('.monaco-workbench').count()) {
        page = candidate;
        break;
      }
    } catch {}
  }
  if (page) break;
  await new Promise(resolve => setTimeout(resolve, 300));
}
if (!page) throw new Error('VS Code workbench renderer not found');
await page.waitForSelector('.monaco-workbench', { timeout: 15000 });

const start = performance.now();
for (let i = 0; i < total; i++) {
  const target = start + i * 1000 / fps;
  const remaining = target - performance.now();
  if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
  const name = String(i).padStart(4, '0');
  await page.screenshot({
    path: `${out}/frame_${name}.jpg`,
    type: 'jpeg',
    quality: 82,
    fullPage: false,
    animations: 'allow',
    caret: 'hide',
  });
  if (i % Math.max(1, fps * 5) === 0) console.log(`Captured ${i + 1}/${total}`);
}
console.log(`Captured ${total} real VS Code renderer frames`);
