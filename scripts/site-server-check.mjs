import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { buildSite } from './site-build.mjs';
export async function checkServerFiles(browser) {
  const raw = { name: 'raw', setup(b) { b.onResolve({ filter: /\?raw$/ }, a => ({ path: resolve(a.resolveDir, a.path.slice(0, -4)), namespace: 'raw' })); b.onLoad({ filter: /.*/, namespace: 'raw' }, async a => ({ contents: await readFile(a.path, 'utf8'), loader: 'text' })); } };
  await build({ entryPoints: ['plant/server.ts'], outfile: '.plant/site-files-server.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external', plugins: [raw] });
  await buildSite('dist/plant/site');
  const { startPlantServer } = await import(pathToFileURL(resolve('.plant/site-files-server.mjs')));
  const directory = await mkdtemp(join(tmpdir(), 'saturn-shell-files-'));
  let app, context, operatorContext, viewerContext;
  try {
    const password = randomBytes(24).toString('base64url');
    const operatorPassword = randomBytes(24).toString('base64url'), viewerPassword = randomBytes(24).toString('base64url');
    app = await startPlantServer({ port: 0, data: join(directory, 'db.sqlite'), repository: join(directory, 'project.git'), password, autoTick: false });
    app.auth.seed('operator', operatorPassword, 'operator');
    app.auth.seed('viewer', viewerPassword, 'viewer');
    const engineer = { id: 'engineer', role: 'engineer' };
    const initial = await app.service.files(engineer);
    assert(app.service.project.devices.length > 40, 'Exercise the real installation, not the small landing example');
    // Keep every installation file. The navigator must handle real relative paths,
    // documentation and configuration without replacing the operational project.
    const documentPath = 'docs/operations/README.md';
    const fixtures = {
      [documentPath]: '# Operations\r\n\r\nSERVER_BASELINE_REVISION\r\n',
      'config/areas/cooling.json': '{"area":"cooling","revision":1}\n',
      'lib/helpers/labels.ts': 'export const labels = { pump: "P-01", area: "Cooling" };\n',
    };
    const seededFiles = { ...initial.files, ...fixtures };
    const seeded = await app.service.save(seededFiles, initial.id, 'Add navigator documentation and configuration', engineer);
    const snapshot = await app.service.files(engineer);
    assert.equal(snapshot.id, seeded.id);
    assert.deepEqual(snapshot.files, seededFiles, 'Nested files must make a round trip through the real Git repository');
    const files = snapshot.files;
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    const anonymous = await context.request.get(app.origin + '/plant/api/project');
    assert.equal(anonymous.status(), 401, 'Project files must not be available without a session');
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(app.origin);
    await page.locator('.export-options').evaluate(menu => menu.open = true); await page.locator('#server-open').click(); await page.locator('#server-load').click();
    await page.waitForFunction(() => document.getElementById('server-error')?.textContent?.includes('Войдите'));
    assert.notEqual(await page.locator('#studio-shell').getAttribute('data-server-project'), 'true', 'Authentication failure must leave the current project intact');
    const login = await context.request.post(app.origin + '/plant/api/login', { data: { user: 'engineer', password }, headers: { Origin: app.origin } });
    assert.equal(login.status(), 200);
    const authenticated = await context.request.get(app.origin + '/plant/api/project');
    assert.equal(authenticated.status(), 200);
    const response = await authenticated.json();
    assert.equal(response.id, snapshot.id);
    assert.deepEqual(response.files, files, 'Authenticated API returns the complete committed file map');
    // Retry in the same open dialog after the authenticated session cookie arrives.
    await page.locator('#server-load').click();
    await page.waitForFunction(() => document.getElementById('studio-shell').dataset.serverProject === 'true');
    assert((await page.locator('#file-origin').textContent()).includes(snapshot.id.slice(0, 8)));
    assert.equal(await page.locator('#file-tree').getAttribute('role'), 'tree');
    assert((await page.locator('#file-project-name').innerText()).trim().length > 0, 'Tree identifies its project');
    await page.locator('[data-file="cooling.ts"]').click();
    assert((await page.locator('#studio-editor .cm-content').innerText()).includes('simulation'));
    assert.equal(await page.locator('#studio-svg [data-node]').count(), app.service.project.devices.length);

    // Folder navigation follows the tree keyboard pattern and opens actual documents.
    await page.locator('#files-collapse').click();
    const docs = page.locator('#file-tree [data-folder="docs"]');
    assert.equal(await docs.getAttribute('aria-expanded'), 'false');
    await docs.focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await docs.getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement?.closest('[role="treeitem"]')?.getAttribute('data-folder')), 'docs/operations', 'ArrowRight enters an expanded folder');
    await page.keyboard.press('ArrowRight');
    const readme = page.locator(`#file-tree [data-file="${documentPath}"]`);
    await readme.waitFor({ state: 'visible' });
    await readme.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#studio-editor .cm-content')?.textContent?.includes('SERVER_BASELINE_REVISION'));
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(() => document.activeElement?.closest('[role="treeitem"]')?.getAttribute('data-folder')), 'docs/operations', 'ArrowLeft moves a file to its parent folder');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#file-tree [data-folder="docs/operations"]').getAttribute('aria-expanded'), 'false');
    await page.locator('#files-collapse').click();
    await page.locator('#files-reveal').click();
    assert.equal(await docs.getAttribute('aria-expanded'), 'true', 'Reveal expands active document ancestors');
    assert.equal(await page.locator('#file-tree [data-folder="docs/operations"]').getAttribute('aria-expanded'), 'true');
    assert(await readme.isVisible());

    // Search matches the path, even when folders are collapsed, and opens the same file.
    await page.locator('#files-collapse').click();
    const search = page.locator('#file-search');
    for (const path of Object.keys(fixtures)) {
      await search.fill(path.toUpperCase());
      assert.equal(await page.locator('#file-tree [data-file]').count(), 1, `Path search must find ${path}`);
      const match = page.locator(`#file-tree [data-file="${path}"]`);
      assert(await match.isVisible(), 'Search results ignore collapsed ancestors');
      assert((await page.locator('#file-tree').innerText()).includes(path.slice(0, path.lastIndexOf('/'))), 'Flat results include their relative parent path');
      await match.click();
      await page.waitForFunction(expected => document.querySelector('#studio-editor .cm-content')?.textContent?.includes(expected), fixtures[path].split(/\r?\n/).find(line => line.length > 0));
    }
    await search.fill(documentPath); await readme.click(); await search.fill('');
    await page.locator('#files-reveal').click();

    // Keep a local edit while the backend receives a real new Git revision.
    const editor = page.locator('#studio-editor .cm-content');
    await editor.click(); await editor.press('ControlOrMeta+End'); await page.keyboard.insertText('\nLOCAL_DRAFT_ONLY\n');
    await page.waitForFunction(path => document.querySelector(`#file-tree [data-file="${path}"]`)?.getAttribute('data-dirty') === 'true', documentPath);
    await page.locator('#files-changed').click();
    assert.equal(await page.locator('#files-changed').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#file-tree [data-file]').count(), 1, 'Changed filter shows the modified document only');
    assert.equal(await readme.getAttribute('data-dirty'), 'true');
    assert.match(await page.locator('#file-results').innerText(), /1/);
    await page.locator('#files-changed').click();

    const revisedFiles = {
      ...files,
      [documentPath]: '# Operations\n\nREMOTE_REVISION_TWO\n',
      'config/areas/cooling.json': '{"area":"cooling","revision":2}\n',
      'docs/operations/revisions.md': '# Revision history\n\nAdded on the server.\n',
    };
    const revised = await app.service.save(revisedFiles, snapshot.id, 'Update operations from another engineer', engineer);
    assert.notEqual(revised.id, snapshot.id);
    const current = await context.request.get(app.origin + '/plant/api/project');
    assert.equal(current.status(), 200);
    assert.equal((await current.json()).id, revised.id, 'A new real server revision is available before refreshing the Shell');
    await page.locator('#server-refresh').click();
    await page.locator('#server-update').waitFor({ state: 'visible' });
    assert(await page.locator('#server-apply').isDisabled(), 'Applying a remote revision must be blocked by a dirty document');
    assert((await page.locator('#file-origin').innerText()).includes(snapshot.id.slice(0, 8)), 'The edited workspace remains on its original revision');
    assert((await editor.innerText()).includes('LOCAL_DRAFT_ONLY'), 'Refresh must preserve the local draft');
    assert(!(await editor.innerText()).includes('REMOTE_REVISION_TWO'), 'Remote contents must not silently overwrite the draft');
    assert.equal(await readme.getAttribute('data-dirty'), 'true');

    // Returning this document to its baseline permits the exact pending revision to apply.
    await editor.focus(); await editor.press('ControlOrMeta+z');
    await page.waitForFunction(() => !document.getElementById('server-apply')?.disabled);
    assert(!(await editor.innerText()).includes('LOCAL_DRAFT_ONLY'));
    await page.locator('#server-apply').click();
    await page.waitForFunction(id => document.getElementById('file-origin')?.textContent?.includes(id), revised.id.slice(0, 8));
    await search.fill(documentPath); await readme.click();
    await page.waitForFunction(() => document.querySelector('#studio-editor .cm-content')?.textContent?.includes('REMOTE_REVISION_TWO'));
    assert.notEqual(await readme.getAttribute('data-dirty'), 'true');
    await search.fill('docs/operations/revisions.md');
    assert.equal(await page.locator('#file-tree [data-file="docs/operations/revisions.md"]').count(), 1, 'Applying the revision adds its new file to the navigator');
    await search.fill('');
    assert.equal(await page.locator('#studio-svg [data-node]').count(), app.service.project.devices.length, 'Navigation and revision changes preserve the complete installation');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('saturn.shell.workspace.v1')).projects.length), 0);

    // Engineer can now commit and publish from the integrated Shell without opening /plant/app/.
    await search.fill(documentPath); await readme.click(); await search.fill('');
    await editor.click(); await editor.press('ControlOrMeta+End'); await page.keyboard.insertText('\nCOMMIT_FROM_INTEGRATED_SHELL\n');
    await page.waitForFunction(() => !document.getElementById('server-save')?.disabled);
    assert(await page.locator('#server-save').isVisible(), 'Engineer sees revision actions in the new Shell');
    await page.locator('#server-save').click();
    await page.locator('#server-commit-message').fill('Integrated Shell commit');
    await page.locator('#server-commit-form button[type=submit]').click();
    await page.locator('#server-commit-dialog').waitFor({ state: 'hidden' });
    const committedResponse = await context.request.get(app.origin + '/plant/api/project');
    const committed = await committedResponse.json();
    assert.notEqual(committed.id, revised.id, 'Integrated Shell created a new Git revision');
    assert(committed.files[documentPath].includes('COMMIT_FROM_INTEGRATED_SHELL'));
    await page.waitForFunction(() => !document.getElementById('server-publish')?.disabled);
    await page.locator('#server-publish').click();
    await page.waitForFunction(async expected => {
      const response = await fetch('/plant/api/session', { cache: 'no-store' });
      if (!response.ok) return false;
      const status = await response.json();
      return status.desired === expected && status.frame.revision === expected;
    }, committed.id);
    assert(await page.locator('#server-publish').isDisabled(), 'Published revision is no longer offered again');

    // Operator opens the same root PWA and gets runtime/HMI, not the engineering IDE.
    operatorContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const operatorLogin = await operatorContext.request.post(app.origin + '/plant/api/login', { data: { user: 'operator', password: operatorPassword }, headers: { Origin: app.origin } });
    assert.equal(operatorLogin.status(), 200);
    assert.equal((await operatorContext.request.get(app.origin + '/plant/api/project')).status(), 403, 'Operator cannot read source files');
    const operatorPage = await operatorContext.newPage(), operatorErrors = []; operatorPage.on('pageerror', error => operatorErrors.push(error.message));
    await operatorPage.goto(app.origin);
    await operatorPage.waitForFunction(() => {
      const shell = document.getElementById('studio-shell');
      return shell?.dataset.role === 'operator' && shell.dataset.runtimeOnly === 'true' && ['live','paused'].includes(shell.dataset.telemetry ?? '');
    });
    assert(await operatorPage.locator('#runtime-controls').isVisible());
    assert(!(await operatorPage.locator('#files-toggle').isVisible()), 'Operator does not see source navigation');
    assert(!(await operatorPage.locator('#studio-code').isVisible()), 'Operator does not see the code editor');
    assert(await operatorPage.locator('#project-trigger').isDisabled(), 'Runtime installation selector is read-only for operator');
    assert.equal(await operatorPage.locator('#studio-svg [data-node]').count(), app.service.project.devices.length);
    const visibleRuntimeNode = operatorPage.locator('#studio-svg [data-node]:visible').first();
    const nodeBox = await visibleRuntimeNode.boundingBox();
    assert(nodeBox && nodeBox.width >= 24 && nodeBox.height >= 18, 'Mobile runtime fit keeps equipment readable');
    const topbarBox = await operatorPage.locator('.shell-topbar').boundingBox();
    assert(topbarBox && topbarBox.height <= 60, 'Operator mobile chrome stays compact');
    await operatorPage.locator('#runtime-controls').click();
    assert(await operatorPage.locator('#runtime-pause').isVisible());
    await operatorPage.locator('#runtime-pause').click();
    await operatorPage.waitForFunction(() => document.getElementById('studio-shell')?.dataset.telemetry === 'paused');
    await operatorPage.locator('#runtime-pause').click();
    await operatorPage.waitForFunction(() => document.getElementById('studio-shell')?.dataset.telemetry === 'live');
    await mkdir('test-results/site-studio', { recursive: true });
    await operatorPage.screenshot({ path: 'test-results/site-studio/operator-mobile.png' });
    assert.deepEqual(operatorErrors, []);

    // Viewer gets the same live projection but no command surface.
    viewerContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const viewerLogin = await viewerContext.request.post(app.origin + '/plant/api/login', { data: { user: 'viewer', password: viewerPassword }, headers: { Origin: app.origin } });
    assert.equal(viewerLogin.status(), 200);
    assert.equal((await viewerContext.request.get(app.origin + '/plant/api/project')).status(), 403, 'Viewer cannot read source files');
    const viewerPage = await viewerContext.newPage(), viewerErrors = []; viewerPage.on('pageerror', error => viewerErrors.push(error.message));
    await viewerPage.goto(app.origin);
    await viewerPage.waitForFunction(() => {
      const shell = document.getElementById('studio-shell');
      return shell?.dataset.role === 'viewer' && shell.dataset.runtimeOnly === 'true' && ['live','paused'].includes(shell.dataset.telemetry ?? '');
    });
    assert(await viewerPage.locator('#runtime-controls').isVisible());
    assert(!(await viewerPage.locator('#runtime-pause').isVisible()), 'Viewer cannot pause runtime');
    await viewerPage.locator('#runtime-controls').click();
    const viewerOperate = viewerPage.locator('.runtime-control-edit button');
    assert(await viewerOperate.count() > 0, 'Real project exposes operator controls');
    for (let i = 0; i < await viewerOperate.count(); i++) assert(await viewerOperate.nth(i).isDisabled(), 'Viewer controls stay disabled');
    assert.deepEqual(viewerErrors, []);

    assert.deepEqual(errors, []);
    console.log('PASS: real Node/Git installation; integrated engineer commit/publish; operator mobile runtime and viewer read-only role; nested files, protected drafts and revisions.');
  } finally { await viewerContext?.close(); await operatorContext?.close(); await context?.close(); await app?.close(); await rm(directory, { recursive: true, force: true }); }
}
