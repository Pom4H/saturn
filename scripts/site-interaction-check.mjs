import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/** Button journeys run in an isolated browser profile; no user projects are touched. */
export async function checkInteractions(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'], locale: 'en-US' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const menu = async selector => {
    if (await page.locator('.export-options').getAttribute('open') === null) await page.locator('.export-options summary').click();
    await page.locator(selector).click();
  };
  const assertScene = async () => {
    assert.equal(await page.locator('#studio-shell').getAttribute('data-view'), 'scene');
    assert(await page.locator('#scene-panel').isVisible());
  };
  const signals = async () => { await page.locator('.shell-topbar [data-shell-view="signals"]').click(); assert(await page.locator('#signals-panel').isVisible()); };
  const choose = async value => { await page.locator('#project-trigger').click(); await page.locator(`[data-project="${value}"]`).click(); };
  try {
    await page.goto(origin + '/#workspace');
    await page.waitForSelector('#studio-spatial canvas', { state: 'attached' });
    await page.locator('#files-toggle').click();
    await page.locator('.export-options summary').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.export-options').getAttribute('open'), null, 'Escape dismisses the menu');
    assert(await page.locator('#file-browser').isVisible(), 'Escape must not close a panel underneath the menu');
    await page.locator('.export-options summary').click();
    await page.locator('#studio-code').click();
    assert.equal(await page.locator('.export-options').getAttribute('open'), null, 'Outside click dismisses the menu');
    await page.locator('#files-close').click();
    await page.locator('#studio-2d').click();
    assert.equal(await page.locator('#studio-shell').getAttribute('data-mode'), '2d');
    await page.locator('#studio-3d').click();
    assert.equal(await page.locator('#studio-shell').getAttribute('data-mode'), '3d');
    await page.locator('#studio-plus').click(); await page.locator('#studio-minus').click(); await page.locator('#studio-fit').click();
    await page.locator('#studio-2d').click();
    const pause = await page.locator('#studio-play').getAttribute('aria-pressed');
    await page.locator('#studio-play').click(); assert.notEqual(await page.locator('#studio-play').getAttribute('aria-pressed'), pause);
    await page.locator('#studio-play').click(); assert.equal(await page.locator('#studio-play').getAttribute('aria-pressed'), pause);

    await signals(); await page.locator('#studio-code').click(); await assertScene();
    assert(await page.locator('#studio-editor-pane').isVisible(), 'Code action must open a visible editor from signals');
    await signals(); await page.locator('#files-toggle').click(); await assertScene();
    assert(await page.locator('#file-browser').isVisible(), 'Files action must reveal its tree from signals');
    await page.locator('#files-close').click();
    await page.locator('#studio-svg [data-node="V-01"]').press('Enter');
    await signals(); await page.locator('#inspector-toggle').click(); await assertScene();
    assert(await page.locator('.studio-inspector').isVisible(), 'Properties action must route back to the scene');
    const opening = page.getByRole('spinbutton', { name: 'V-01: Открытие', exact: true });
    await opening.fill('49'); await opening.press('Tab');
    assert.equal(await opening.inputValue(), '49');
    await page.locator('#studio-undo').click(); assert.equal(await opening.inputValue(), '80');
    await page.locator('#studio-redo').click(); assert.equal(await opening.inputValue(), '49');
    await page.locator('#object-source').click(); assert(await page.locator('#studio-editor-pane').isVisible());
    await page.locator('#inspector-close').click();
    await page.locator('#equipment-toggle').click();
    await page.locator('#studio-catalog').selectOption('pump');
    const count = await page.locator('#studio-svg [data-node]').count();
    await page.locator('#studio-add').click(); assert.equal(await page.locator('#studio-svg [data-node]').count(), count + 1);
    await page.locator('.studio-delete').click(); assert.equal(await page.locator('#studio-svg [data-node]').count(), count);
    await page.locator('#equipment-close').click();
    await page.locator('#studio-connect').click(); assert.equal(await page.locator('#studio-connect').getAttribute('aria-pressed'), 'true');
    await page.locator('#studio-connect').click(); assert.equal(await page.locator('#studio-connect').getAttribute('aria-pressed'), 'false');

    await page.locator('#project-create').click(); await page.locator('#project-name').fill('Button audit copy');
    await page.locator('#project-form button[type=submit]').click();
    assert.match(await page.locator('#project-trigger').innerText(), /Button audit copy/);
    await menu('#project-duplicate'); await page.locator('#project-name').fill('Button audit duplicate');
    await page.locator('#project-form button[type=submit]').click();
    assert.match(await page.locator('#project-trigger').innerText(), /Button audit duplicate/);
    await menu('[data-shell-view="projects"]');
    assert(await page.locator('#projects-panel').isVisible());
    await page.locator('.project-card').filter({ hasText: 'Button audit copy' }).click(); await assertScene();

    let pending = page.waitForEvent('download'); await menu('#studio-download');
    const sourceDownload = await pending; assert.equal(sourceDownload.suggestedFilename(), 'saturn-station.ts');
    const exportedSource = await readFile(await sourceDownload.path(), 'utf8'); assert.match(exportedSource, /opening: 49/);
    pending = page.waitForEvent('download'); await menu('#studio-html');
    const htmlDownload = await pending; assert.equal(htmlDownload.suggestedFilename(), 'saturn-scene.html');
    assert.match(await readFile(await htmlDownload.path(), 'utf8'), /id="source"/);
    // A local project may be opened after a server URL; sharing must not retain server autoload intent.
    await page.evaluate(() => history.replaceState(null, '', '?project=server&source=simulation#workspace'));
    await menu('#studio-share');
    const share = await page.evaluate(() => navigator.clipboard.readText()); assert.match(share, /#code=/);
    assert.equal(new URL(share).searchParams.has('project'), false, 'Shared local source must not autoload the server');
    assert.equal(new URL(share).searchParams.has('source'), false);
    const shared = await context.newPage(); await shared.goto(share); await shared.waitForSelector('#studio-spatial canvas', { state: 'attached' });
    assert.match(await shared.locator('#project-trigger').innerText(), /Project from link/); await shared.close();

    await signals();
    const picker = page.waitForEvent('filechooser'); await menu('#studio-import');
    await (await picker).setFiles({ name: 'audit-import.ts', mimeType: 'text/plain', buffer: Buffer.from(exportedSource) });
    await page.waitForFunction(() => document.getElementById('project-trigger')?.textContent.includes('audit-import'));
    await assertScene();
    assert.match(await page.locator('#project-trigger').innerText(), /audit-import/);

    await choose('template:plant');
    await page.locator('#file-tree [data-file="systems/pumping.ts"]').dblclick();
    await page.locator('#file-tree [data-file="README.md"]').click();
    assert(await page.locator('[data-tab="systems/pumping.ts"]').isVisible(), 'Double-click pins a document');
    await page.locator('#file-search').fill('systems/');
    assert.equal(await page.locator('#file-tree [data-file]').count(), 1);
    await page.locator('#files-clear-search').click();
    await page.locator('#files-collapse').click(); assert.equal(await page.locator('#file-tree [data-file="systems/pumping.ts"]').count(), 0);
    await page.locator('#files-reveal').click(); assert(await page.locator('#file-tree [data-file="README.md"]').isVisible());
    await page.locator('#files-changed').click(); assert.match(await page.locator('#file-tree').innerText(), /Нет изменений/);
    await page.locator('#files-changed').click();
    await menu('#project-duplicate'); await page.locator('#project-name').fill('Audit multi README copy');
    await page.locator('#project-form button[type=submit]').click();
    assert.equal(await page.locator('#studio-shell').getAttribute('data-project-kind'), 'plant', 'Copy uses the entire project when README is active');
    assert.match(await page.locator('#file-tabs').innerText(), /README.md/);
    pending = page.waitForEvent('download'); await menu('#studio-download'); const json = await pending;
    const files = JSON.parse(await readFile(await json.path(), 'utf8')); assert(files['plant.ts'] && files['README.md'] && files['systems/pumping.ts']);
    const jsonPicker = page.waitForEvent('filechooser'); await menu('#studio-import');
    await (await jsonPicker).setFiles({ name: 'AUDIT.JSON', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(files)) });
    await page.waitForFunction(() => document.getElementById('project-trigger')?.textContent.includes('AUDIT'));
    assert.equal(await page.locator('#studio-shell').getAttribute('data-project-kind'), 'plant');
    await menu('[data-new-project]'); await page.locator('#project-name').fill('Audit empty');
    await page.locator('#project-form button[type=submit]').click();
    assert.equal(await page.locator('#studio-shell').getAttribute('data-project-kind'), 'core');
    assert.equal(await page.locator('#studio-svg [data-node]').count(), 0);
    await page.locator('#empty-add').click(); assert(await page.locator('#equipment-browser').isVisible());
    await page.locator('#equipment-close').click();
    await menu('#server-open'); assert(await page.locator('#server-dialog').isVisible()); await page.locator('#server-close').click();
    await menu('[data-new-project]'); await page.locator('#project-dialog-close').click();
    await page.locator('#shell-fullscreen').click(); assert(!await page.locator('body').evaluate(el => el.classList.contains('shell-fullscreen')));
    await page.locator('#shell-fullscreen').click(); assert(await page.locator('body').evaluate(el => el.classList.contains('shell-fullscreen')));
    await page.setViewportSize({ width: 390, height: 600 });
    await signals(); await page.locator('#mobile-scene').click(); await assertScene();
    await page.locator('.export-options summary').click();
    const menuBounds = await page.locator('.export-options > div').boundingBox();
    assert(menuBounds && menuBounds.y >= 0 && menuBounds.y + menuBounds.height <= 600, 'Menu fits a short mobile viewport');
    await page.locator('.export-options [data-install-studio]').scrollIntoViewIfNeeded();
    assert(await page.locator('.export-options [data-install-studio]').isVisible(), 'Last menu action remains reachable');
    assert.deepEqual(errors, [], 'Button journeys must not produce uncaught errors');
    console.log('Shell button journeys: cross-view actions, modes, inspector, undo/redo, equipment, copy/duplicate, TS/HTML/share/JSON exports, import, navigator, empty project, dialogs and fullscreen passed');
  } finally { await context.close(); }
}
