import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const endpoint = process.env.VSCODE_CDP ?? 'http://127.0.0.1:9222';
const out = resolve(process.env.VSCODE_FRAME_DIR ?? 'vscode-video/frames');
const seconds = Number(process.env.VSCODE_CAPTURE_SECONDS ?? 50);

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

mkdirSync(out, { recursive: true });
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

const session = await context.newCDPSession(page);
const frames = [];
let stopped = false;
let writeError;

session.on('Page.screencastFrame', async event => {
  try {
    await session.send('Page.screencastFrameAck', { sessionId: event.sessionId });
    if (stopped) return;
    const index = frames.length;
    const name = `frame_${String(index).padStart(4, '0')}.jpg`;
    writeFileSync(resolve(out, name), Buffer.from(event.data, 'base64'));
    frames.push({
      name,
      timestamp: Number(event.metadata?.timestamp ?? 0),
    });
  } catch (error) {
    writeError = error;
  }
});

await session.send('Page.startScreencast', {
  format: 'jpeg',
  quality: 82,
  maxWidth: 1280,
  maxHeight: 720,
  everyNthFrame: 1,
});

await new Promise(resolve => setTimeout(resolve, seconds * 1000));
stopped = true;
await session.send('Page.stopScreencast');
await new Promise(resolve => setTimeout(resolve, 500));
if (writeError) throw writeError;
if (frames.length < 8) throw new Error(`Screencast produced only ${frames.length} frames`);

const firstTs = frames[0].timestamp;
const normalized = frames.map(frame => ({
  ...frame,
  time: frame.timestamp > 0 && firstTs > 0 ? Math.max(0, frame.timestamp - firstTs) : 0,
}));
for (let i = 1; i < normalized.length; i++) {
  if (!(normalized[i].time > normalized[i - 1].time)) normalized[i].time = normalized[i - 1].time + 0.04;
}

const lines = [];
for (let i = 0; i < normalized.length; i++) {
  const current = normalized[i];
  const next = normalized[i + 1];
  const duration = next ? Math.max(0.04, Math.min(10, next.time - current.time)) : Math.max(0.5, seconds - current.time);
  lines.push(`file '${current.name}'`);
  lines.push(`duration ${duration.toFixed(4)}`);
}
lines.push(`file '${normalized.at(-1).name}'`);
writeFileSync(resolve(out, 'concat.txt'), lines.join('\n') + '\n');
writeFileSync(resolve(out, 'timeline.json'), JSON.stringify({
  seconds,
  frameCount: normalized.length,
  frames: normalized,
}, null, 2));

console.log(`Captured ${normalized.length} composited VS Code screencast frames over ${seconds}s`);
await browser.close();
