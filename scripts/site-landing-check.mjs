import assert from 'node:assert/strict';
import { checkHoverAndSvg } from './site-hover-svg-check.mjs';
import { mkdir } from 'node:fs/promises';
import { loadSiteModule } from './site-build.mjs';

/** Runs in the existing release gate: no extra workflow or installation. */
export async function checkLandingDemo(browser, origin) {
  const { examples, createWorkspace, createProject, workspaceKey } = await loadSiteModule('shell-projects');
  const saved = createWorkspace();
  createProject(saved, 'Saved engineering project', examples.pump.source.replace('rpm: 1850', 'rpm: 2111'), 'saved-project');
  const workspace = JSON.stringify(saved), layoutKey = 'saturn.shell.layout.v1';
  const layout = JSON.stringify({ filesVisible: true, codeVisible: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', colorScheme: 'light', serviceWorkers: 'block' });
  const errors = [], runtimeRequests = [];
  try {
    // Seed only once: a reload must expose accidental demo writes, not overwrite them.
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
    await page.locator('#studio-svg [data-node="P-01"]').waitFor({ state: 'attached' });
    const shell = page.locator('#studio-shell'), content = page.locator('#studio-editor .cm-content');
    // CodeMirror virtualizes the DOM: innerText is not the authored document.
    // This test-only bridge targets the pinned view package; no production globals.
    const source = () => content.evaluate(node => {
      const view = node.cmTile?.view;
      if (!view?.state?.doc) throw new Error('Mounted CodeMirror document is unavailable');
      return view.state.doc.toString();
    });
    await checkHoverAndSvg(page);
    const initial = await source();
    assert.match(initial, /from '@saturn\/core'/, 'Landing authors the canonical Saturn package');
    assert.match(initial, /pipe\('suction'/, 'Fluid topology is authored as pipe()');
    assert.match(initial, /pipe\('delivery'/, 'Both pipe connections are authored in the project');
    assert.doesNotMatch(initial, /@scada\/core|\bconnect\s*\(/, 'Legacy scene DSL is absent from the landing');
    assert.equal(await shell.getAttribute('data-demo'), 'true');
    assert.equal(await shell.getAttribute('data-mode'), '2d');
    assert.equal(await page.locator('#studio-spatial canvas').count(), 0, 'No 3D renderer mounted');
    assert.equal(await shell.locator('button:visible').count(), 4, 'Only undo, reset, pause and fit');
    for (const selector of ['.shell-topbar', '.shell-contextbar', '#file-browser', '#equipment-browser', '.studio-inspector']) {
      assert(!await page.locator(selector).isVisible(), `${selector} must stay out of the demo`);
    }
    assert(await page.locator('#studio-editor-pane').isVisible(), 'Source is visible on desktop despite saved layout');
    assert.equal(await page.locator('#studio-play').getAttribute('aria-pressed'), 'false', 'Reduced motion starts paused');
    await page.locator('#studio-play').click();
    assert.equal(await page.locator('#studio-play').getAttribute('aria-pressed'), 'true');
    await page.locator('#studio-play').click();

    const pipe = page.locator('#studio-svg [data-connection="suction"][data-medium="pipe"] path').first();
    const delivery = page.locator('#studio-svg [data-connection="delivery"][data-medium="pipe"] path').first();
    assert.equal(await page.locator('#studio-svg [data-connection][data-medium="pipe"]').count(), 2);
    assert.equal(await page.locator('#studio-svg [data-connection][data-medium="power"]').count(), 0);
    const pipeBefore = await pipe.getAttribute('d');
    assert(await delivery.getAttribute('d'), 'The return pipe meets the original top pump outlet');
    const pump = page.locator('#studio-svg [data-node="P-01"]');
    // Use the actual casing center; a group bounding box includes labels, ports and shadows.
    const casing = pump.locator('[data-anatomy="saturn-pump"] > circle[r="48"]');
    await casing.scrollIntoViewIfNeeded();
    const box = await casing.boundingBox(); assert(box);
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-node]')?.getAttribute('data-node'), point), 'P-01', 'Drag starts on the pump, not a clipped/overlaid part of its bounds');
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    await page.mouse.move(point.x + 40, point.y + 20, { steps: 5 });
    assert.notEqual(await pipe.getAttribute('d'), pipeBefore, 'Pipes follow during drag, not just after drop');
    assert.equal(await source(), initial, 'Drag preview does not spam source history');
    await page.mouse.up();
    assert.notEqual(await source(), initial, 'Dragging edits canonical TypeScript');
    assert(!await page.locator('.studio-inspector').isVisible(), 'Selection must not reveal hidden features');
    await page.locator('#studio-undo').click();
    assert.equal(await source(), initial, 'One undo reverts one drag');

    const transform = await pump.getAttribute('transform');
    await content.click(); await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(initial.replace('x: 390, y: 190', 'x: 490, y: 190'));
    assert.notEqual(await pump.getAttribute('transform'), transform, 'Code edits update the real diagram');
    const validTransform = await pump.getAttribute('transform');
    await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('\ninvalid(');
    await page.waitForFunction(() => document.querySelector('#studio-diagnostics').dataset.error === 'true');
    assert.equal(await pump.getAttribute('transform'), validTransform, 'Invalid source preserves the last valid scene');
    assert(await page.locator('#studio-diagnostics').isVisible(), 'Errors remain discoverable');
    await page.locator('#demo-reset').click();
    assert.equal(await source(), initial);
    assert(!await page.locator('#studio-diagnostics').isVisible());
    await page.locator('#studio-svg').focus(); await page.keyboard.press('Control+k');
    assert(!await page.locator('#shell-command-dialog').isVisible(), 'No hidden command palette shortcut');

    const readSaved = () => page.evaluate(keys => keys.map(key => localStorage.getItem(key)), [workspaceKey, layoutKey]);
    assert.deepEqual(await readSaved(), [workspace, layout], 'Demo never changes IDE projects or layout');
    await mkdir('test-results/release-shell/landing-demo', { recursive: true });
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await shell.screenshot({ path: `test-results/release-shell/landing-demo/${scheme}.png` });
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 390, height: 844 });
    // Viewport emulation can finish before the resize listener updates the pane.
    await page.locator('#studio-editor-pane').waitFor({ state: 'hidden' });
    assert(!await page.locator('#studio-editor-pane').isVisible());
    await page.locator('[data-demo-pane="source"]').click();
    assert(await page.locator('#studio-editor-pane').isVisible());
    assert(!await page.locator('.studio-viewport').isVisible());
    await page.locator('[data-demo-pane="scene"]').click();
    assert(await page.locator('.studio-viewport').isVisible());
    for (const button of await shell.locator('button:visible').all()) assert((await button.boundingBox()).height >= 44, 'Touch controls are at least 44px high');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal mobile overflow');
    await shell.screenshot({ path: 'test-results/release-shell/landing-demo/mobile.png' });
    await page.reload();
    await page.locator('#studio-svg [data-node="P-01"]').waitFor({ state: 'attached' });
    assert.deepEqual(await readSaved(), [workspace, layout]);
    assert.deepEqual(runtimeRequests, [], 'Demo does not probe servers');

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.demo-open').click();
    await page.waitForFunction(() => document.body.classList.contains('shell-fullscreen'));
    assert.equal(new URL(page.url()).searchParams.get('mode'), 'ide');
    assert.equal(await page.locator('.demo-header').count(), 0);
    assert(await page.locator('.shell-topbar').isVisible(), 'Full IDE retains its tools');
    assert(await page.locator('#file-browser').isVisible(), 'Full IDE restores saved layout');
    assert.match(await source(), /rpm: 2111/, 'Full IDE restores the saved project, not disposable demo edits');
    assert.deepEqual(errors, []);
    console.log('PASS: canonical @saturn/core landing; native process pipe authoring; live rerouting; two-way editing; storage isolation; mobile; full IDE handoff.');
  } finally { await context.close(); }
}
