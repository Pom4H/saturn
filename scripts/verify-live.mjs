import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const url = process.env.SATURN_URL || 'https://pom4h.github.io/saturn/';
await mkdir('live-check', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));

try {
  let status = 0;
  const expectedRevision = process.env.GITHUB_SHA;
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    status = response?.status() || 0;
    const revision = await page.locator('meta[name="saturn-revision"]').getAttribute('content').catch(() => null);
    if (status === 200 && (!expectedRevision || revision === expectedRevision)) break;
    await page.waitForTimeout(5000);
  }

  assert.equal(status, 200, 'Published Saturn landing returns HTTP 200');
  if (expectedRevision) {
    assert.equal(await page.locator('meta[name="saturn-revision"]').getAttribute('content'), expectedRevision, 'Published revision matches this workflow');
  }

  await page.waitForSelector('#studio-svg [data-node]', { state: 'attached' });
  assert.equal(await page.locator('#studio-shell').getAttribute('data-demo'), 'true');
  assert.equal(await page.locator('#studio-spatial canvas').count(), 0, 'Landing does not mount 3D');
  const primaryHeading = page.locator('h1');
  assert.equal(await primaryHeading.count(), 1, 'Landing has exactly one primary heading');
  assert((await primaryHeading.innerText()).trim().length > 0, 'Landing primary heading is not empty');
  assert.equal(await page.locator('#workflow, #readiness, #start').count(), 3, 'Landing keeps the workflow, readiness, and start sections');
  assert((await page.locator('a[href*="mode=ide"]').count()) > 0, 'Landing exposes an entry into the IDE');
  assert.equal(await page.locator('.eyebrow, .section-number, .demo-intro').count(), 0, 'Published landing has no marketing kickers');
  assert.equal(await page.locator('.live-product-frame').count(), 2, 'Landing exposes live IDE and runtime surfaces');
  const runtimeResponse = await page.request.get(new URL('plant/demo/', url).href);
  assert.equal(runtimeResponse.status(), 200, 'Published Pages artifact includes the live runtime demo');

  assert((await page.locator('#studio-svg [data-node]').count()) > 0, 'Published landing renders the real Saturn scene');

  const expectedScope = new URL('./', url).pathname;
  const scope = await page.evaluate(async () => new URL((await navigator.serviceWorker.ready).scope).pathname);
  assert.equal(scope, expectedScope, 'PWA scope follows the deployed Pages base path');

  await page.screenshot({ path: 'live-check/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile landing has no horizontal document overflow');
  await page.screenshot({ path: 'live-check/mobile.png', fullPage: true });

  assert.deepEqual(errors, []);
  const result = {
    url,
    status,
    revision: expectedRevision,
    passed: true,
    checks: ['Saturn landing', 'no marketing kickers', 'live IDE/runtime surfaces', 'real 2D scene', 'base-path-safe PWA', 'mobile layout', 'no page errors'],
  };
  await writeFile('live-check/result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await page.screenshot({ path: 'live-check/failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
