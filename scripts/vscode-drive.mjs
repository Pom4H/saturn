import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const endpoint = process.env.VSCODE_CDP ?? 'http://127.0.0.1:9222';

async function waitEndpoint() {
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(endpoint + '/json/version', { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('VS Code DevTools endpoint did not become available');
}

async function command(page, name) {
  await page.keyboard.press('Control+Shift+P');
  await page.waitForTimeout(250);
  await page.keyboard.type(name, { delay: 15 });
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
}

await waitEndpoint();
const browser = await chromium.connectOverCDP(endpoint);
const context = browser.contexts()[0];
if (!context) throw new Error('VS Code CDP context not found');

let page;
for (let i = 0; i < 60; i++) {
  for (const candidate of context.pages()) {
    try {
      if (await candidate.locator('.monaco-workbench').count()) {
        page = candidate;
        break;
      }
    } catch {}
  }
  if (page) break;
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (!page) throw new Error('VS Code workbench page not found');

await page.bringToFront();
await page.waitForSelector('.monaco-workbench', { timeout: 15000 });

async function clickAcrossFrames(label) {
  for (const frame of page.frames()) {
    for (const locator of [
      frame.getByRole('button', { name: label, exact: true }),
      frame.getByRole('link', { name: label, exact: true }),
      frame.getByText(label, { exact: true }),
    ]) {
      try {
        const count = await locator.count();
        for (let i = count - 1; i >= 0; i--) {
          const item = locator.nth(i);
          if (await item.isVisible({ timeout: 250 })) {
            await item.click({ force: true, timeout: 1000 });
            await page.waitForTimeout(700);
            return true;
          }
        }
      } catch {}
    }
  }
  return false;
}

for (let pass = 0; pass < 6; pass++) {
  const text = await page.locator('body').innerText().catch(() => '');
  if (!/Welcome to VS Code|Sign in to use GitHub Copilot|Signing in to github.com/i.test(text)) break;
  let acted = false;
  for (const label of ['Continue without Signing In', 'Cancel', 'Skip', 'Done', 'Start Using VS Code', 'Continue']) {
    if (await clickAcrossFrames(label)) { acted = true; break; }
  }
  if (!acted) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
}

await page.bringToFront();
await command(page, 'View: Close All Editors');
await page.keyboard.press('Control+P');
await page.waitForTimeout(300);
await page.keyboard.type('plant.ts', { delay: 20 });
await page.keyboard.press('Enter');
await page.waitForTimeout(1200);

await page.keyboard.press('Control+Alt+s');
await page.waitForTimeout(1800);

let body = await page.locator('body').innerText();
if (!/Equipment Catalog|Targets|Saturn/i.test(body)) {
  const saturn = page.locator('[aria-label*="Saturn"], [title*="Saturn"]').first();
  if (await saturn.count()) {
    await saturn.click();
    await page.waitForTimeout(1200);
  }
}

await command(page, 'Saturn: Open Diagram');
await page.waitForTimeout(7000);

body = await page.locator('body').innerText();
console.log(body.slice(0, 10000));
if (!body.includes('Saturn Diagram')) throw new Error('Saturn Diagram did not open in VS Code');
if (!body.includes('Equipment Catalog')) throw new Error('Saturn Equipment Catalog view is not visible');

await mkdir('vscode-screenshot', { recursive: true });
await page.screenshot({ path: 'vscode-screenshot/saturn-vscode-workbench.png', fullPage: false });
