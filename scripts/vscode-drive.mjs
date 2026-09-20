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

for (let i = 0; i < 3; i++) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
}

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
