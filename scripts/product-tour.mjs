import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { mkdtemp, mkdir, rm, copyFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

const raw = { name: 'project-source', setup(b) {
  b.onResolve({ filter: /\?raw$/ }, a => ({ path: resolve(a.resolveDir, a.path.slice(0, -4)), namespace: 'raw' }));
  b.onLoad({ filter: /.*/, namespace: 'raw' }, async a => ({ contents: await readFile(a.path, 'utf8'), loader: 'text' }));
} };
const out = process.env.SATURN_TOUR_OUT ?? 'product-tour';
await mkdir(out, { recursive: true });
await build({ entryPoints: ['plant/server.ts'], outfile: '.plant/tour-server.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external', plugins: [raw] });
const { startPlantServer } = await import(pathToFileURL(join(process.cwd(), '.plant/tour-server.mjs')));
const work = await mkdtemp(join(tmpdir(), 'saturn-tour-'));
const password = () => randomBytes(24).toString('base64url');
const passwords = { engineer: password(), operator: password(), viewer: password() };
let app, browser;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function login(page, user) {
  await page.goto(app.origin + '/plant/login');
  await page.locator('[name=user]').fill(user);
  await page.locator('[name=password]').fill(passwords[user]);
  await page.locator('#login button').click();
  await page.waitForFunction(expected => {
    const shell = document.getElementById('studio-shell');
    return shell?.dataset.role === expected &&
      (expected === 'engineer' ? shell.dataset.serverProject === 'true' : shell.dataset.runtimeOnly === 'true');
  }, user === 'engineer' ? 'engineer' : user);
  await pause(700);
}

async function logout(page) {
  const ok = await page.evaluate(async () => {
    const status = await fetch('/plant/api/session', { cache: 'no-store' });
    if (!status.ok) return false;
    const session = await status.json();
    const response = await fetch('/plant/api/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf },
      body: '{}',
    });
    return response.ok;
  });
  if (!ok) throw new Error('Failed to log out integrated Shell session');
  await page.goto(app.origin + '/plant/login');
  await pause(350);
}

try {
  app = await startPlantServer({ port: 0, data: join(work, 'plant.sqlite'), repository: join(work, 'project.git'), user: 'engineer', password: passwords.engineer });
  app.auth.seed('operator', passwords.operator, 'operator');
  app.auth.seed('viewer', passwords.viewer, 'viewer');

  browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, recordVideo: { dir: out, size: { width: 1600, height: 1000 } } });
  const page = await context.newPage();

  await login(page, 'engineer');
  if (!(await page.locator('#studio-code').isVisible())) throw new Error('engineer cannot see integrated source editor');
  const source = page.locator('#studio-editor .cm-content');
  await source.click();
  await source.press('ControlOrMeta+End');
  await page.keyboard.insertText('\n// Product tour revision from the unified Saturn Shell.\n');
  await page.waitForFunction(() => !document.getElementById('server-save')?.disabled);
  await page.locator('#server-save').click();
  await page.locator('#server-commit-message').fill('Product tour: unified Shell');
  await page.locator('#server-commit-form button[type=submit]').click();
  await page.locator('#server-commit-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => !document.getElementById('server-publish')?.disabled);
  await page.locator('#server-publish').click();
  await page.waitForFunction(() => document.getElementById('studio-shell')?.dataset.telemetry === 'live' && document.getElementById('server-publish')?.hasAttribute('disabled'));
  await page.locator('#studio-2d').click();
  await page.locator('#studio-fit').click();
  await pause(1600);

  await logout(page);
  await login(page, 'operator');
  if (await page.locator('#studio-code').isVisible()) throw new Error('operator can see source editor');
  await page.locator('#runtime-controls').click();
  const enabledCard = page.locator('.runtime-control-card').filter({ has: page.locator('.runtime-control-edit button:not([disabled])') }).first();
  const input = enabledCard.locator('input');
  const apply = enabledCard.locator('button');
  const min = Number(await input.getAttribute('min')), max = Number(await input.getAttribute('max'));
  await input.fill(String(min + (max - min) * .55));
  await apply.click();
  await pause(1200);
  await page.locator('#runtime-pause').click();
  await page.waitForFunction(() => document.getElementById('studio-shell')?.dataset.telemetry === 'paused');
  await pause(650);
  await page.locator('#runtime-pause').click();
  await page.waitForFunction(() => document.getElementById('studio-shell')?.dataset.telemetry === 'live');
  await page.locator('#runtime-alarms').click();
  await pause(1200);

  await logout(page);
  await login(page, 'viewer');
  if (await page.locator('#studio-code').isVisible()) throw new Error('viewer can see source editor');
  await page.locator('#runtime-controls').click();
  if (await page.locator('.runtime-control-edit button:not([disabled])').count()) throw new Error('viewer has enabled controls');
  if (await page.locator('#runtime-pause').isVisible()) throw new Error('viewer can pause runtime');
  await pause(1100);
  await page.locator('#runtime-alarms').click();
  await pause(1200);
  await page.locator('[data-shell-view="scene"]:visible').click();
  await page.locator('#studio-fit').click();
  await pause(1400);

  const video = page.video();
  await page.close();
  await context.close();
  await copyFile(await video.path(), join(out, 'saturn-engineer-operator-viewer.webm'));
  console.log(JSON.stringify({ ok: true, video: join(out, 'saturn-engineer-operator-viewer.webm'), ui: 'unified-shell' }));
} finally {
  await browser?.close().catch(() => {});
  await app?.close().catch(() => {});
  for (let attempt = 0; attempt < 8; attempt++) {
    try { await rm(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 }); break; }
    catch (error) {
      if (attempt === 7) console.warn('Temporary tour directory is still locked; leaving it for OS cleanup:', error.message);
      else await pause(250 * (attempt + 1));
    }
  }
}
