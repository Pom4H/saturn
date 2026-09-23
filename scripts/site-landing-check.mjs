import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { loadSiteModule } from './site-build.mjs';

/** Real root navigation, canonical source, and state isolation in the existing release gate. */
export async function checkLandingDemo(browser, origin) {
  const { examples, createWorkspace, createProject, workspaceKey } = await loadSiteModule('shell-projects');
  const saved = createWorkspace();
  createProject(saved, 'Saved engineering project', examples.pump.source.replace('inertia: 1.6', 'inertia: 2.1'), 'saved-project');
  const workspace = JSON.stringify(saved), layoutKey = 'saturn.shell.layout.v1';
  const layout = JSON.stringify({ filesVisible: true, codeVisible: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', colorScheme: 'light', serviceWorkers: 'block' });
  const errors = [], runtimeRequests = [];
  try {
    await context.addInitScript(({ workspaceKey, workspace, layoutKey, layout }) => {
      if (!sessionStorage.getItem('landing-test-seeded')) {
        localStorage.setItem(workspaceKey, workspace); localStorage.setItem(layoutKey, layout);
        sessionStorage.setItem('landing-test-seeded', 'true');
      }
    }, { workspaceKey, workspace, layoutKey, layout });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/plant/')) runtimeRequests.push(request.url()); });
    await page.goto(origin);
    const pump = page.locator('#studio-svg [data-node="P-01"]');
    await pump.waitFor({ state: 'attached' });
    const shell = page.locator('#studio-shell'), content = page.locator('#studio-editor .cm-content');
    const source = () => content.innerText(), initial = await source();
    assert.match(initial, /@saturn\/core/); assert.match(initial, /pipe\('PIPE-01'/); assert.match(initial, /cable\('CABLE-01'/);
    assert.doesNotMatch(initial, /@scada\/core|\bconnect\s*\(/);
    assert.match(initial, /inertia: 1.6/, 'Landing ignores the saved project');
    assert.equal(await shell.getAttribute('data-demo'), 'true');
    assert.equal(await shell.getAttribute('data-mode'), '2d');
    assert.equal(await page.locator('#studio-spatial canvas').count(), 0);
    assert.equal(await page.locator('#studio-svg [data-edge]').count(), 0, 'No legacy edges');
    assert.equal(await page.locator('#studio-svg [data-connection][data-medium="pipe"]').count(), 3);
    assert.equal(await page.locator('#studio-svg [data-connection][data-medium="power"]').count(), 1);
    assert.equal(await shell.locator('button:visible').count(), 4);
    for (const selector of ['.shell-topbar', '.shell-contextbar', '#file-browser', '#equipment-browser', '.studio-inspector']) assert(!await page.locator(selector).isVisible());
    assert(await page.locator('#studio-editor-pane').isVisible());
    assert.equal(await page.locator('#studio-play').getAttribute('aria-pressed'), 'false');
    await page.locator('#studio-play').click(); assert.equal(await page.locator('#studio-play').getAttribute('aria-pressed'), 'true');
    await page.locator('#studio-play').click();
    const paths = ['PIPE-01', 'CABLE-01'].map(id => page.locator(`#studio-svg [data-connection="${id}"] path`).first());
    const before = await Promise.all(paths.map(path=>path.getAttribute('d')));
    const box = await pump.boundingBox(); assert(box);
    await page.mouse.move(box.x + box.width * .6, box.y + box.height * .75); await page.mouse.down();
    await page.mouse.move(box.x + box.width * .6 + 40, box.y + box.height * .75 + 20, { steps: 5 });
    for (const [i,path] of paths.entries()) assert.notEqual(await path.getAttribute('d'), before[i], 'Both physical routes move before drop');
    assert.equal(await source(), initial, 'Drag preview does not edit source');
    await page.mouse.up(); assert.notEqual(await source(), initial);
    assert(!await page.locator('.studio-inspector').isVisible());
    await page.locator('#studio-undo').click(); assert.equal(await source(), initial, 'One undo restores exact source');
    for (const [i,path] of paths.entries()) assert.equal(await path.getAttribute('d'), before[i]);
    const transform = await pump.getAttribute('transform');
    await content.click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText(initial.replace('x: 330', 'x: 430'));
    assert.notEqual(await pump.getAttribute('transform'), transform);
    const validTransform = await pump.getAttribute('transform');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(initial.replace('drive.ports.out, pump.ports.drive', 'tank.ports.outlet, pump.ports.drive'));
    await page.waitForFunction(() => document.querySelector('#studio-diagnostics').dataset.error === 'true');
    assert.match(await page.locator('#studio-diagnostics').innerText(), /SATURN_/);
    assert.equal(await pump.getAttribute('transform'), validTransform, 'Invalid cable keeps the last valid scene');
    await page.locator('#demo-reset').click(); assert.equal(await source(), initial);
    assert(!await page.locator('#studio-diagnostics').isVisible());
    await page.locator('#studio-svg').focus(); await page.keyboard.press('Control+k');
    assert(!await page.locator('#shell-command-dialog').isVisible());
    const readSaved = () => page.evaluate(keys => keys.map(key => localStorage.getItem(key)), [workspaceKey, layoutKey]);
    assert.deepEqual(await readSaved(), [workspace, layout]);
    await mkdir('test-results/release-shell/landing-demo', { recursive: true });
    for (const scheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme: scheme }); await shell.screenshot({ path: `test-results/release-shell/landing-demo/${scheme}.png` }); }
    await page.emulateMedia({ colorScheme: 'light' }); await page.setViewportSize({ width: 390, height: 844 });
    assert(!await page.locator('#studio-editor-pane').isVisible());
    await page.locator('[data-demo-pane="source"]').click(); assert(await page.locator('#studio-editor-pane').isVisible()); assert(!await page.locator('.studio-viewport').isVisible());
    await page.locator('[data-demo-pane="scene"]').click(); assert(await page.locator('.studio-viewport').isVisible());
    for (const button of await shell.locator('button:visible').all()) assert((await button.boundingBox()).height >= 44);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await shell.screenshot({ path: 'test-results/release-shell/landing-demo/mobile.png' });
    await page.reload(); await pump.waitFor({ state:'attached' }); assert.deepEqual(await readSaved(), [workspace, layout]);
    assert.deepEqual(runtimeRequests, [], 'Demo does not probe servers');
    await page.setViewportSize({ width:1440, height:1000 }); await page.locator('.demo-open').click();
    await page.waitForFunction(() => document.body.classList.contains('shell-fullscreen'));
    assert.equal(new URL(page.url()).searchParams.get('mode'), 'ide');
    assert.equal(await page.locator('.demo-header').count(), 0); assert(await page.locator('.shell-topbar').isVisible());
    assert(await page.locator('#file-browser').isVisible());
    assert.match(await content.innerText(), /inertia: 2.1/, 'IDE restores the saved canonical project');
    assert.equal(await page.locator('#studio-svg [data-connection]').count(), 4);
    assert.deepEqual(errors, []);
    console.log('PASS: canonical landing and IDE; real pipe/cable drag; undo; typed errors; storage isolation; mobile and reload.');
  } finally { await context.close(); }
}
