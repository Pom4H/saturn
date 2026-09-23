import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { rawText } from './esbuild-raw-text.mjs';
import { mkdtemp, mkdir, rm, copyFile, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { writeSiteCache } from './site-build.mjs';

/** Capture the actual authenticated shell, not a marketing reconstruction. */
export async function captureLandingProof(browser, siteDir) {
  const out = 'test-results/release-shell/product';
  await mkdir(out, { recursive: true });
  await mkdir('.plant', { recursive: true });
  await build({ entryPoints: ['plant/server.ts'], outfile: '.plant/landing-proof-server.mjs', bundle: true,
    platform: 'node', format: 'esm', packages: 'external', plugins: [rawText] });
  const { startPlantServer } = await import(pathToFileURL(resolve('.plant/landing-proof-server.mjs')));
  const work = await mkdtemp(join(tmpdir(), 'saturn-landing-proof-'));
  const passwords = { engineer: randomBytes(24).toString('base64url'), operator: randomBytes(24).toString('base64url') };
  const revision = (await readFile(`${siteDir}/index.html`, 'utf8')).match(/name="saturn-revision" content="([^"]+)"/)?.[1];
  assert(revision, 'Screenshots must have build provenance');
  let app;
  const contexts = [];
  async function login(role) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce', colorScheme: 'light', serviceWorkers: 'block' });
    contexts.push(context);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(app.origin + '/plant/login');
    await page.locator('[name=user]').fill(role);
    await page.locator('[name=password]').fill(passwords[role]);
    await page.locator('#login button').click();
    await page.waitForFunction(expected => {
      const shell = document.getElementById('studio-shell');
      return shell?.dataset.role === expected && (expected === 'engineer' ? shell.dataset.serverProject === 'true' : shell.dataset.runtimeOnly === 'true');
    }, role);
    await page.waitForFunction(() => document.getElementById('studio-shell')?.dataset.telemetry === 'live');
    if (!(await page.evaluate(() => document.body.classList.contains('shell-fullscreen')))) await page.locator('#shell-fullscreen').click();
    if (await page.locator('#studio-2d').isVisible()) await page.locator('#studio-2d').click();
    await page.locator('#studio-fit').click();
    return { page, context };
  }
  async function capture(page, role) {
    assert.equal(await page.locator('meta[name="saturn-revision"]').getAttribute('content'), revision, 'Capture must use this exact site build');
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      const file = `proof-${role}-${scheme}.png`;
      await page.locator('#studio-shell').screenshot({ path: join(out, file) });
      await copyFile(join(out, file), `${siteDir}/assets/${file}`);
    }
  }
  const errors = [];
  try {
    app = await startPlantServer({ port: 0, data: join(work, 'plant.sqlite'), repository: join(work, 'project.git'), user: 'engineer', password: passwords.engineer });
    app.auth.seed('operator', passwords.operator, 'operator');
    const engineering = await login('engineer');
    const page = engineering.page;
    if (!await page.locator('#studio-editor-pane').isVisible()) await page.locator('#studio-code').click();
    const source = page.locator('#studio-editor .cm-content');
    await source.click();
    await source.press('ControlOrMeta+End');
    await page.keyboard.insertText('\n// Проверенный пример для знакомства с Saturn.\n');
    await page.waitForFunction(() => !document.getElementById('server-save')?.disabled);
    await page.locator('#server-save').click();
    await page.locator('#server-commit-message').fill('Landing proof: engineer publishes the demonstration project');
    await page.locator('#server-commit-form button[type=submit]').click();
    await page.locator('#server-commit-dialog').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !document.getElementById('server-publish')?.disabled);
    await page.locator('#server-publish').click();
    await page.waitForFunction(() => document.getElementById('studio-shell')?.dataset.telemetry === 'live' && document.getElementById('server-publish')?.hasAttribute('disabled'));
    const applied = await page.locator('#revision-applied').textContent();
    assert(applied && applied !== '—', 'The project must actually be applied');
    await source.press('ControlOrMeta+Home');
    await capture(page, 'engineer');
    await engineering.context.close(); // Runtime must survive closing the engineering workstation.

    const { page: operator } = await login('operator');
    assert(!await operator.locator('#studio-code').isVisible(), 'Operator has no code editor');
    assert(!await operator.locator('#server-publish').isVisible(), 'Operator cannot publish');
    assert.equal(await operator.locator('#revision-applied').textContent(), applied, 'Both roles use the same published project');
    await operator.locator('#runtime-controls').click();
    assert(await operator.locator('.runtime-control-edit button:not([disabled])').count() > 0, 'Operator has allowed controls');
    await operator.locator('#runtime-pause').click();
    await operator.waitForFunction(() => document.getElementById('studio-shell')?.dataset.telemetry === 'paused');
    await operator.locator('#runtime-pause').click();
    await operator.waitForFunction(() => document.getElementById('studio-shell')?.dataset.telemetry === 'live');
    await operator.locator('#runtime-alarms').click();
    assert(await operator.locator('#alarms-panel').isVisible(), 'Operator can inspect alarm state');
    await operator.locator('[data-shell-view="scene"]:visible').first().click();
    await operator.locator('#studio-fit').click();
    await capture(operator, 'operator');
    assert.deepEqual(errors, [], 'Authenticated capture has no browser exceptions');
    const manifest = JSON.stringify({ available: true, revision, source: 'authenticated-server-simulation', roles: ['engineer', 'operator'], applied }, null, 2);
    await writeFile(`${siteDir}/assets/landing-proof.json`, manifest);
    await writeFile(join(out, 'landing-proof.json'), manifest);
    await writeSiteCache(siteDir); // Generated evidence is part of this build's offline cache identity.
    console.log('PASS: real engineer publication -> independent operator session; roles, pause/resume, alarms; light/dark screenshots.');
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await app?.close().catch(() => {});
    await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

/** Landing acceptance checks share the release browser and the exact built assets. */
export async function checkLandingStory(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', colorScheme: 'light', serviceWorkers: 'block' });
  try {
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/?mode=demo');
    await page.locator('#studio-svg [data-node="P-01"]').waitFor({ state: 'attached' });
    assert.match(await page.locator('h1').innerText(), /Инженерная IDE/);
    assert.match(await page.locator('h1').innerText(), /со встроенной SCADA/);
    assert.match(await page.locator('.demo-boundary').innerText(), /Без подключения к оборудованию/);
    await page.locator('#workflow').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.getElementById('workflow')?.dataset.proof === 'ready');
    await page.locator('.engineer-proof img').evaluate(image => image.decode());
    assert(await page.locator('.engineer-proof img').evaluate(image => image.naturalWidth > 1000), 'A real full-size captured screen is loaded');
    await page.locator('#proof-engineer').focus();
    await page.keyboard.press('ArrowRight');
    assert(await page.locator('#proof-operator').isChecked(), 'Native keyboard switching works');
    assert(await page.locator('.operator-proof').isVisible());
    assert(!await page.locator('.engineer-proof').isVisible());
    await page.locator('.operator-proof img').evaluate(image => image.decode());
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForFunction(theme => document.querySelector('.operator-proof img')?.currentSrc.endsWith(`proof-operator-${theme}.png`), theme);
      await page.locator('.operator-proof img').evaluate(image => image.decode());
      assert((await page.locator('.operator-proof img').evaluate(image => image.currentSrc)).endsWith(`proof-operator-${theme}.png`));
      await page.screenshot({ path: `test-results/release-shell/landing-${theme}.png`, fullPage: true });
    }
    await page.emulateMedia({ colorScheme: 'light' });
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Landing has no overflow at ${width}px`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'test-results/release-shell/landing-mobile.png', fullPage: true });
    for (const link of await page.locator('.site-header .landing-button, .hero-actions .landing-button').all()) assert.equal(await link.getAttribute('href'), '?mode=ide#workspace');
    const localLinks = await page.locator('a[href^="#"]').evaluateAll(links => links.map(link => link.getAttribute('href')).filter(href => href.length > 1));
    for (const href of localLinks) assert(await page.locator(href).count() > 0, `Local destination exists: ${href}`);
    assert.deepEqual(errors, []);
    console.log('PASS: buyer-facing story; authenticated screenshots and provenance; keyboard role switch; system themes; 320/390/768px; working CTAs.');
  } finally { await context.close(); }
}
