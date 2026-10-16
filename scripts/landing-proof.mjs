import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { rawText } from './esbuild-raw-text.mjs';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

/** Capture the actual authenticated shell, not a marketing reconstruction. */
async function checkDiagramContrast(page) {
  const ratio = await page.locator('#studio-svg').evaluate(svg => {
    const label = svg.querySelector('[data-node] .object-label text');
    const plate = svg.querySelector('[data-group] > [data-outline]');
    if (!label || !plate) throw new Error('The demonstrated diagram must contain equipment and its group surface');
    const luminance = element => {
      const color = getComputedStyle(element).fill;
      const values = color.match(/[\d.]+/g)?.map(Number);
      if (!color.startsWith('rgb(') || values?.length !== 3) throw new Error(`Unexpected computed diagram color: ${color}`);
      const linear = values.map(value => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const a = luminance(label), b = luminance(plate);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  assert(ratio >= 4.5, `Equipment labels must remain readable on their actual backplate: ${ratio.toFixed(2)}:1`);
}

export async function captureLandingProof(browser, siteDir) {
  const out = 'test-results/release-shell/product';
  await mkdir(out, { recursive: true });
  await mkdir('.plant', { recursive: true });
  await build({ entryPoints: { server: 'scripts/site-workspace-server.ts' },
    outdir: '.plant/landing-proof', outExtension: { '.js': '.mjs' }, bundle: true,
    platform: 'node', format: 'esm', packages: 'external', plugins: [rawText] });
  const { startWorkspaceTestServer } = await import(pathToFileURL(resolve('.plant/landing-proof/server.mjs')));
  const sourceProject = await readFile('examples/operator-pump/src/plant.ts', 'utf8');
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
    const anonymous = await context.request.get(app.origin + '/plant/ide/');
    assert.equal(anonymous.status(), 401, 'Anonymous clients cannot enter the authoring document');
    assert(!anonymous.headers()['content-security-policy'].includes("'unsafe-eval'"));
    const response = await context.request.post(app.origin + '/plant/api/login', {
      data: { user: role, password: passwords[role] }, headers: { Origin: app.origin },
    });
    assert.equal(response.status(), 200, 'Real Saturn authentication succeeds');
    assert((await context.cookies()).some(cookie => cookie.name === 'scada_session' && cookie.httpOnly));
    const authoring = await context.request.get(app.origin + '/plant/ide/');
    assert.equal(authoring.status(), role === 'engineer' ? 200 : 403, 'Only engineers can enter the trusted build document');
    assert.equal(authoring.headers()['content-security-policy'].includes("'unsafe-eval'"), role === 'engineer');
    assert.equal(authoring.headers()['cache-control'], 'no-store');
    if (role === 'operator') assert.equal((await context.request.get(app.origin + '/plant/api/workspace')).status(), 403);
    const root = await context.request.get(app.origin + '/');
    assert(!root.headers()['content-security-policy'].includes("'unsafe-eval'"), 'Public and runtime entry keep strict script policy');
    await page.goto(app.origin + '/?project=server#workspace');
    if (role === 'engineer') await page.waitForURL(url => url.pathname === '/plant/ide/');
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
  async function capture(page, role, variant = '') {
    assert.equal(await page.locator('meta[name="saturn-revision"]').getAttribute('content'), revision, 'Capture must use this exact site build');
    await page.locator('#shell-toast').waitFor({ state: 'hidden' });
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await checkDiagramContrast(page);
      const file = `proof-${role}${variant}-${scheme}.png`;
      await page.locator('#studio-shell').screenshot({ path: join(out, file) });
    }
  }
  const errors = [];
  try {
    const project = join(work, 'project');
    await mkdir(join(project, 'src'), { recursive: true });
    await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'saturn-landing-proof', private: true, type: 'module', version: '0.0.0' }));
    await writeFile(join(project, 'src/plant.ts'), sourceProject);
    app = await startWorkspaceTestServer({ project, data: join(work, 'plant.sqlite'), password: passwords.engineer,
      root: resolve(siteDir, '..'), autoTick: true });
    app.auth.seed('operator', passwords.operator, 'operator');
    const engineering = await login('engineer');
    const page = engineering.page;
    if (!await page.locator('#studio-editor-pane').isVisible()) await page.locator('#studio-code').click();
    const source = page.locator('#studio-editor .cm-content');
    await source.click();
    await source.press('ControlOrMeta+End');
    await page.keyboard.insertText('\n// Проверенный пример для знакомства с Saturn.\n');
    await page.waitForFunction(() => !document.getElementById('server-save')?.disabled);
    const before = await (await engineering.context.request.get(app.origin + '/plant/api/session')).json();
    const saved = page.waitForResponse(response => response.url().endsWith('/plant/api/workspace/save') && response.request().method() === 'POST');
    await page.locator('#server-save').click();
    const saveResponse = await saved; assert.equal(saveResponse.status(), 200);
    const snapshot = await saveResponse.json();
    assert.notEqual(snapshot.id, before.frame.revision, 'Saving creates a new artifact identity');
    assert.equal((await (await engineering.context.request.get(app.origin + '/plant/api/session')).json()).frame.revision, before.frame.revision, 'Save does not deploy');
    await page.waitForFunction(() => !document.getElementById('server-publish')?.disabled);
    await page.locator('#server-publish').click();
    await page.waitForFunction(() => document.getElementById('studio-shell')?.dataset.telemetry === 'live' && document.getElementById('server-publish')?.hasAttribute('disabled'));
    const deployed = await (await engineering.context.request.get(app.origin + '/plant/api/session')).json();
    assert.equal(deployed.frame.revision, snapshot.id, 'The checked artifact is actually applied');
    const applied = deployed.frame.revision;
    const appliedLabel = await page.locator('#revision-applied').textContent();
    assert.equal(appliedLabel, applied.replace(/^sha256:/, '').slice(0, 8), 'Show a distinguishing build hash, not only the sha256 prefix');
    assert.equal(await page.locator('#revision-applied').getAttribute('title'), applied, 'Full artifact identity remains inspectable');
    assert.equal(await page.locator('#studio-count').textContent(), '3 объектов · 2 связей', 'Engineering counts include canonical pipe connections');
    await source.press('ControlOrMeta+Home');
    if (await page.locator('#file-browser').isVisible()) await page.locator('#files-toggle').click();
    await page.locator('#studio-fit').click();
    await capture(page, 'engineer');
    await engineering.context.close(); // Runtime must survive closing the engineering workstation.

    const { page: operator } = await login('operator');
    assert(!await operator.locator('#studio-code').isVisible(), 'Operator has no code editor');
    assert(!await operator.locator('#server-publish').isVisible(), 'Operator cannot publish');
    assert.equal(await operator.locator('#studio-count').textContent(), '3 объектов · 2 связей', 'Runtime counts must not retain the unrelated starter project');
    assert.notEqual(await operator.locator('#revision-source').textContent(), 'demo', 'An authenticated runtime is not labelled as the local demo source');
    assert.equal(await operator.locator('#revision-applied').textContent(), appliedLabel, 'Both roles display the same published project');
    assert.equal((await (await operator.context().request.get(app.origin + '/plant/api/session')).json()).frame.revision, applied);
    await operator.locator('#runtime-controls').click();
    assert(await operator.locator('.runtime-control-edit button:not([disabled])').count() > 0, 'Operator has allowed controls');
    await operator.locator('#runtime-pause').click();
    await operator.waitForFunction(() => document.getElementById('studio-shell')?.dataset.telemetry === 'paused');
    // Work through the real command UI. Pause prevents a moving simulation from
    // changing the input while the explicit request is entered; it is resumed below.
    const drive = operator.locator('.runtime-control-card').filter({ has: operator.getByRole('heading', { name: 'P-101 · скорость насоса' }) });
    async function applyDrive(value) {
      await drive.locator('input').fill(String(value));
      const sent = operator.waitForResponse(response => response.url().endsWith('/plant/api/command') && response.request().method() === 'POST');
      await drive.getByRole('button', { name: 'Применить', exact: true }).click();
      const response = await sent;
      assert.equal(response.status(), 200, 'The server accepts the authorized operator command');
      assert.equal(response.request().postDataJSON().value, value);
    }
    async function session() {
      const response = await operator.context().request.get(app.origin + '/plant/api/session');
      assert.equal(response.status(), 200);
      return response.json();
    }
    async function observe(predicate, message) {
      const deadline = Date.now() + 15_000;
      do {
        const current = await session();
        if (predicate(current.frame)) return current.frame;
        await new Promise(resolve => setTimeout(resolve, 100));
      } while (Date.now() < deadline);
      assert.fail(message);
    }
    await applyDrive(0);
    await operator.locator('#runtime-pause').click();
    await operator.waitForFunction(() => document.getElementById('studio-shell')?.dataset.telemetry === 'live');
    const warning = await observe(frame => frame.samples['P-101.flow']?.quality === 'good'
      && frame.samples['P-101.flow'].value < 0.3 && frame.alarms.some(alarm => alarm.id === 'low-flow' && alarm.active),
      'An actual low-flow observation must raise the declared warning');
    assert.equal(warning.samples['DRIVE.requested'].value, 0);
    await operator.locator('#runtime-alarms').click();
    assert(await operator.locator('#alarms-panel').isVisible(), 'Operator can inspect alarm state');
    const alarm = operator.locator('.runtime-alarm').filter({ hasText: 'P-101: низкий расход' });
    await alarm.getByRole('button', { name: 'Подтвердить', exact: true }).click();
    await observe(frame => frame.alarms.some(alarm => alarm.id === 'low-flow' && alarm.active && alarm.acknowledged),
      'Acknowledgement must retain the still-active condition');
    await operator.locator('#runtime-controls').click();
    await operator.locator('#runtime-pause').click();
    await operator.waitForFunction(() => document.getElementById('studio-shell')?.dataset.telemetry === 'paused');
    await applyDrive(0.72);
    await operator.locator('#runtime-pause').click();
    const restored = await observe(frame => frame.samples['P-101.flow']?.value > 0.715
      && frame.alarms.some(alarm => alarm.id === 'low-flow' && !alarm.active && alarm.acknowledged),
      'Restoring the drive must clear the condition while retaining its acknowledgement');
    assert.equal(restored.revision, applied, 'Operational commands do not change the applied project');
    await operator.locator('[data-shell-view="scene"]:visible').first().click();
    await operator.locator('#studio-fit').click();
    await capture(operator, 'operator');
    await operator.setViewportSize({ width: 390, height: 760 });
    await operator.locator('#runtime-controls').click();
    assert(await drive.locator('input').isEnabled(), 'The responsive operator screen retains permitted controls');
    assert(await operator.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'The real mobile runtime fits its viewport');
    await capture(operator, 'operator', '-mobile');
    assert.deepEqual(errors, [], 'Authenticated capture has no browser exceptions');
    const manifest = JSON.stringify({ available: true, revision, source: 'authenticated-server-simulation', roles: ['engineer', 'operator'], applied, project: 'operator-pump', mobileOperator: true, checks: ['publish', 'independent-operator', 'command', 'observed-flow', 'alarm-raised', 'acknowledged-active', 'condition-cleared'] }, null, 2);
    await writeFile(join(out, 'landing-proof.json'), manifest);
    console.log('PASS: real engineer publication -> independent operator session; roles, scoped authoring CSP, command -> measured model response -> active alarm -> acknowledgement -> recovery; light/dark screenshots.');
  } catch (error) {
    for (const [index, context] of contexts.entries()) for (const page of context.pages()) {
      await page.screenshot({ path: join(out, `failed-${index}.png`), fullPage: true }).catch(() => {});
      console.error('Capture state:', await page.locator('#studio-shell').evaluate(shell => ({ ...shell.dataset })).catch(() => null));
      console.error('Capture diagnostic:', await page.locator('#server-error').textContent().catch(() => null));
    }
    throw error;
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
    const example = await context.request.get(origin + '/site/assets/operator-pump.json');
    assert.equal(example.status(), 200, 'The demonstrated project is downloadable');
    assert.deepEqual(await example.json(), { 'plant.ts': await readFile('examples/operator-pump/src/plant.ts', 'utf8') }, 'The downloadable project is exactly the source exercised by the server');

    await page.goto(origin + '/?mode=demo');
    await page.locator('#studio-svg [data-node="P-01"]').waitFor({ state: 'attached' });
    assert.match(await page.locator('h1').innerText(), /Инженерная IDE/);
    assert.match(await page.locator('h1').innerText(), /со встроенной SCADA/);
    assert.equal(await page.locator('.eyebrow, .section-number, .demo-intro').count(), 0, 'Landing has no marketing kickers');

    await page.locator('#workflow').scrollIntoViewIfNeeded();
    const engineerFrameElement = page.locator('.engineer-proof .live-product-frame');
    await page.waitForFunction(() => Boolean(document.querySelector('.engineer-proof .live-product-frame')?.getAttribute('src')));
    const engineer = page.frameLocator('.engineer-proof .live-product-frame');
    await engineer.locator('#studio-shell').waitFor({ state: 'visible' });
    assert.equal(await engineer.locator('body').getAttribute('data-embed'), 'shell', 'Embedded IDE uses shell-only document mode');
    assert.equal(await engineer.locator('#studio-shell').getAttribute('data-demo'), 'false', 'Embedded engineering surface is the real IDE, not the landing demo');
    assert(await engineer.locator('.shell-topbar').isVisible(), 'Embedded IDE exposes the real application chrome');
    await engineer.locator('#project-switch option').first().waitFor({ state: 'attached' });
    assert((await engineer.locator('#studio-svg [data-node]').count()) > 0 || (await engineer.locator('#studio-spatial canvas').count()) > 0, 'Embedded IDE renders the real project in 2D or 3D');

    await page.locator('#proof-engineer').focus();
    await page.keyboard.press('ArrowRight');
    assert(await page.locator('#proof-operator').isChecked(), 'Native keyboard switching works');
    assert(await page.locator('.operator-proof').isVisible());
    assert(!await page.locator('.engineer-proof').isVisible());

    await page.waitForFunction(() => Boolean(document.querySelector('.operator-proof .live-product-frame')?.getAttribute('src')));
    const operator = page.frameLocator('.operator-proof .live-product-frame');
    await operator.locator('.topbar').waitFor({ state: 'visible' });
    await operator.locator('#application').waitFor({ state: 'visible', timeout: 15000 });
    assert(await operator.locator('[data-tab="scheme"]').isVisible(), 'Embedded runtime exposes the real process surface');
    assert(await operator.locator('[data-tab="alarms"]').isVisible(), 'Embedded runtime exposes actual alarm navigation');

    await page.locator('#workflow-title').click();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await checkDiagramContrast(page);
      await page.screenshot({ path: `test-results/release-shell/landing-${theme}.png`, fullPage: true });
    }

    await page.emulateMedia({ colorScheme: 'light' });
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Landing has no overflow at ${width}px`);
      await page.locator('#workflow').scrollIntoViewIfNeeded();
      assert(await operator.locator('html').evaluate(node => node.scrollWidth <= node.clientWidth + 1), `Live runtime fits its iframe at ${width}px`);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: 'test-results/release-shell/landing-mobile.png', fullPage: true });
    for (const link of await page.locator('.site-header .landing-button, .hero-actions .landing-button').all()) assert.equal(await link.getAttribute('href'), '?mode=ide#workspace');
    const localLinks = await page.locator('a[href^="#"]').evaluateAll(links => links.map(link => link.getAttribute('href')).filter(href => href.length > 1));
    for (const href of localLinks) assert(await page.locator(href).count() > 0, `Local destination exists: ${href}`);
    assert.deepEqual(errors, []);
    console.log('PASS: buyer-facing story; no kickers; live IDE/runtime embeds; keyboard switch; system themes; 320/390/768px; working CTAs.');
  } finally { await context.close(); }
}
