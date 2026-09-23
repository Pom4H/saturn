import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

/** Run after checkServerFiles: that suite builds the server module and current site assets. */
export async function checkTelemetry(browser) {
  const { startWorkspaceTestServer } = await import(pathToFileURL(resolve('.plant/site-workspace-server.mjs')));
  const directory = await mkdtemp(join(tmpdir(), 'saturn-shell-telemetry-'));
  const project = join(directory, 'project');
  await mkdir(join(project, 'src'), { recursive: true });
  await cp(resolve('plant/demo'), join(project, 'src'), { recursive: true });
  await writeFile(join(project, 'package.json'), JSON.stringify({
    name: 'saturn-telemetry-gate', private: true, version: '0.0.0', type: 'module',
    saturn: { title: 'Telemetry release gate' },
  }, null, 2) + '\n');
  const engineer = { id: 'engineer', role: 'engineer' };
  let app, context;
  try {
    const password = randomBytes(24).toString('base64url');
    app = await startWorkspaceTestServer({ project, data: join(directory, 'db.sqlite'), password });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    const login = await context.request.post(app.origin + '/plant/api/login', { data: { user: 'engineer', password }, headers: { Origin: app.origin } });
    assert.equal(login.status(), 200);
    const auth = await login.json();
    const session = await context.request.get(app.origin + '/plant/api/session');
    assert.equal(session.status(), 200);
    const initial = await session.json();
    assert.equal(initial.frame.revision, app.service.frame().revision);
    assert(initial.project.devices.length > 40, 'Telemetry uses the full installation');
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(app.origin + '/?project=server#workspace');
    // Do not wait on Playwright's generic HTTP response event for a long-lived SSE
    // body. The observable contract is stronger: the shell must become live and
    // then consume authoritative server sequence changes below.
    await page.waitForFunction(() => document.getElementById('studio-shell')?.dataset.telemetry === 'live');
    await page.waitForSelector('#studio-spatial canvas', { state: 'attached' });
    const shell = page.locator('#studio-shell');
    assert.equal(await shell.getAttribute('data-server-project'), 'true');
    assert.equal(Number(await shell.getAttribute('data-runtime-seq')), initial.frame.seq);

    // Each manual server tick must reach both renderers, not a browser-only animation loop.
    app.service.tick(); app.service.tick();
    let frame = app.service.tick();
    assert(frame.seq > initial.frame.seq);
    await page.waitForFunction(seq => Number(document.getElementById('studio-shell')?.dataset.runtimeSeq) === seq, frame.seq);
    await page.waitForFunction(seq => Number(document.getElementById('studio-svg')?.dataset.sequence) === seq && Number(document.getElementById('studio-spatial')?.dataset.sequence) === seq, frame.seq);
    await page.locator('#studio-2d').click();
    assert.equal(await page.locator('#studio-svg [data-node]').count(), initial.project.devices.length);
    assert.equal(await page.locator('#studio-svg [data-node][data-mode="simulation"]').count(), initial.project.devices.length, '2D equipment receives simulation frames');

    const direct = initial.project.devices.flatMap(device => Object.entries(device.signals).map(([name, expression]) => ({ device: device.id, name, expression })))
      .find(signal => signal.expression && typeof signal.expression === 'object' && 'ref' in signal.expression && typeof frame.samples[signal.expression.ref]?.value === 'number' && frame.samples[signal.expression.ref]?.quality === 'good');
    assert(direct, 'Installation must expose a direct, good-quality server signal');
    async function readSignal() {
      return page.locator('#signal-rows tr').evaluateAll((rows, key) => {
        const row = rows.find(item => item.cells[0]?.textContent === key.device && item.cells[1]?.textContent === key.name);
        return row ? { text: row.cells[2]?.textContent, value: row.cells[2]?.getAttribute('data-value') ?? row.getAttribute('data-value'), source: row.cells[3]?.textContent } : null;
      }, { device: direct.device, name: direct.name });
    }
    async function assertSignal(sample) {
      const visible = await readSignal();
      assert(visible, 'Signal table must include the server device signal');
      assert.notEqual(visible.text?.trim(), '—', 'Live signal must have a value');
      const actual = visible.value === null ? Number(visible.text?.trim().replace(/\s/g, '').replace(',', '.').match(/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/i)?.[0]) : Number(visible.value);
      assert(Number.isFinite(actual) && Math.abs(actual - sample.value) <= 0.00051, `Signal must show server value ${sample.value}, got ${visible.text}`);
      assert(!/черновик|не подключ/i.test(visible.source ?? ''), 'Live rows must not retain the draft source label');
    }
    await page.locator('[data-shell-view="signals"]').first().click();
    await assertSignal(frame.samples[direct.expression.ref]);
    frame = app.service.tick();
    await page.waitForFunction(seq => Number(document.getElementById('studio-shell')?.dataset.runtimeSeq) === seq, frame.seq);
    await assertSignal(frame.samples[direct.expression.ref]);

    // Runtime pause is an actual service command, and an unchanged sequence remains paused.
    app.service.command({ id: 'shell-test-pause', revision: frame.revision, action: 'pause' }, engineer);
    await page.waitForFunction(() => document.getElementById('studio-shell')?.dataset.telemetry === 'paused');
    const pausedSeq = app.service.frame().seq;
    assert.equal(app.service.tick().seq, pausedSeq);
    assert.equal(await page.locator('#studio-svg [data-node][data-mode="paused"]').count(), initial.project.devices.length);
    app.service.command({ id: 'shell-test-resume', revision: frame.revision, action: 'resume' }, engineer);
    await page.waitForFunction(() => document.getElementById('studio-shell')?.dataset.telemetry === 'live');
    frame = app.service.tick();
    await page.waitForFunction(seq => Number(document.getElementById('studio-shell')?.dataset.runtimeSeq) === seq, frame.seq);

    // A local source edit disconnects applicability even though the authenticated SSE stream is healthy.
    await page.locator('#signals-panel [data-shell-view="scene"]').click();
    if (await page.locator('#file-browser').evaluate(node => node.hidden)) await page.locator('#files-toggle').click();
    await page.locator('#file-search').fill('cooling.ts');
    await page.locator('#file-tree [data-file="src/cooling.ts"]').click();
    const editor = page.locator('#studio-editor .cm-content');
    await editor.click(); await editor.press('ControlOrMeta+End'); await page.keyboard.insertText('\n// LOCAL_TELEMETRY_DRAFT\n');
    await page.waitForFunction(() => document.getElementById('studio-shell')?.dataset.telemetry === 'draft');
    assert.equal(await page.locator('#studio-svg [data-node][data-mode="simulation"]').count(), 0, 'Server values cannot be projected onto modified sources');
    frame = app.service.tick();
    await page.locator('[data-shell-view="signals"]').first().click();
    assert.equal((await readSignal())?.text?.trim(), '—', 'Draft signal values must become unknown');
    await page.locator('#studio-code').click();
    assert(await editor.isVisible(), 'Code button must reveal the editor from the signal table');
    // Creating an unrelated empty project must not discard an in-memory server draft.
    await page.locator('.export-options summary').click();
    await page.locator('.export-options [data-new-project]').click();
    await page.locator('#project-name').fill('Unrelated empty project');
    await page.locator('#project-form button[type="submit"]').click();
    assert.equal(await shell.getAttribute('data-server-project'), 'false');
    await page.locator('#project-trigger').click();
    await page.locator('#project-picker [data-project="server:current"]').click();
    await page.waitForFunction(() => document.getElementById('studio-shell')?.dataset.serverProject === 'true');
    assert.match(await editor.innerText(), /LOCAL_TELEMETRY_DRAFT/, 'Server draft survives unrelated project creation and return');
    assert.equal(await shell.getAttribute('data-telemetry'), 'draft');
    await editor.focus(); await editor.press('ControlOrMeta+z');
    await page.waitForFunction(() => document.getElementById('studio-shell')?.dataset.telemetry === 'live');
    await page.waitForFunction(seq => Number(document.getElementById('studio-shell')?.dataset.runtimeSeq) === seq, frame.seq);

    // A different repository head cannot consume frames from the previously published revision.
    const workspaceResponse = await context.request.get(app.origin + '/plant/api/workspace');
    assert.equal(workspaceResponse.status(), 200);
    const sourceSnapshot = await workspaceResponse.json();
    const changedFiles = { ...sourceSnapshot.files, 'src/cooling.ts': sourceSnapshot.files['src/cooling.ts'] + '\n// SERVER_UNPUBLISHED_REVISION\n' };
    const saveResponse = await context.request.post(app.origin + '/plant/api/workspace/save', {
      data: { files: changedFiles, expected: sourceSnapshot.id },
      headers: { Origin: app.origin, 'X-CSRF-Token': auth.csrf },
    });
    assert.equal(saveResponse.status(), 200);
    const nextRevision = await saveResponse.json();
    await page.locator('#server-refresh').click();
    await page.waitForFunction(() => document.getElementById('studio-shell')?.dataset.telemetry === 'revision');
    assert.equal(await page.locator('#studio-svg [data-node][data-mode="simulation"]').count(), 0, 'Unpublished source revision must not show valid runtime values');
    await page.locator('[data-shell-view="signals"]').first().click();
    assert.equal((await readSignal())?.text?.trim(), '—');
    const beforeDeploy = await (await context.request.get(app.origin + '/plant/api/session')).json();
    const deployResponse = await context.request.post(app.origin + '/plant/api/deploy', {
      data: { expected: beforeDeploy.desired },
      headers: { Origin: app.origin, 'X-CSRF-Token': auth.csrf },
    });
    assert.equal(deployResponse.status(), 200);
    const deployed = await deployResponse.json();
    assert.equal(deployed.desired, nextRevision.id);
    frame = app.service.tick();
    await page.waitForFunction(() => document.getElementById('studio-shell')?.dataset.telemetry === 'live');
    await page.waitForFunction(seq => Number(document.getElementById('studio-shell')?.dataset.runtimeSeq) === seq, frame.seq);
    await assertSignal(frame.samples[direct.expression.ref]);

    // Stop the actual server: retain the last confirmed frame as stale,
    // but fail closed for every operator command until authoritative telemetry returns.
    const beforeLoss = await readSignal();
    const port = Number(new URL(app.origin).port);
    await app.close(); app = undefined;
    await page.waitForFunction(() => document.getElementById('studio-shell')?.dataset.telemetry === 'stale', undefined, { timeout: 15000 });
    assert.equal(await page.locator('#studio-svg [data-node][data-quality="stale"]').count(), initial.project.devices.length, 'Every retained equipment value is visibly stale');
    assert.equal(await page.locator('#studio-svg [data-node][data-mode="simulation"]').count(), initial.project.devices.length, 'Stale rendering retains the identity of the last confirmed simulation frame');
    const stale = await readSignal();
    assert.equal(stale?.text?.trim(), beforeLoss?.text?.trim(), 'Server loss preserves the last confirmed numeric value');
    assert.match(stale?.source ?? '', /stale/i, 'The retained value must be visibly marked stale');
    await page.locator('[data-shell-view="controls"]').first().click();
    assert.equal(await page.locator('.runtime-control-edit button:not([disabled])').count(), 0, 'Commands are disabled while telemetry is stale');
    app = await startWorkspaceTestServer({ project, data: join(directory, 'db.sqlite'), password });
    await page.waitForFunction(() => document.getElementById('studio-shell')?.dataset.telemetry === 'live', undefined, { timeout: 15000 });
    frame = app.service.tick();
    await page.waitForFunction(seq => Number(document.getElementById('studio-shell')?.dataset.runtimeSeq) === seq, frame.seq);
    await assertSignal(frame.samples[direct.expression.ref]);
    assert.deepEqual(errors, [], 'Telemetry lifecycle must not produce unhandled browser errors');
    console.log('PASS: real authenticated SSE, deterministic ticks, shared 2D/3D sequence, pause/resume, draft/revision isolation, stale last-known values, fail-closed controls and reconnect.');
  } finally {
    await context?.close();
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
}
