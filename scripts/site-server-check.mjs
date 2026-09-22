import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { buildSite } from './site-build.mjs';

const plantSource = `import { project, simulation, system } from '@saturn/core';

export const loop = system('loop', 'Circulation');
export const p101 = simulation('P-101', 'pump', {
  system: loop.id,
  at: { x: 280, y: 180 },
});

export default project('first-pump', {
  title: 'First pump',
  description: 'Minimal Saturn engineering project',
  systems: [loop],
  simulations: [p101],
  signals: [],
  alarms: [],
  reports: [],
});
`;

export async function checkServerFiles(browser) {
  await build({
    entryPoints: ['scripts/site-workspace-server.ts'],
    outfile: '.plant/site-workspace-server.mjs',
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
  });
  await buildSite('dist/plant/site');

  const { startWorkspaceTestServer } = await import(pathToFileURL(resolve('.plant/site-workspace-server.mjs')));
  const directory = await mkdtemp(join(tmpdir(), 'saturn-shell-workspace-'));
  const project = join(directory, 'first-pump');
  let app, engineerContext, operatorContext, viewerContext;

  try {
    await mkdir(join(project, 'src'), { recursive: true });
    await mkdir(join(project, 'docs'), { recursive: true });
    await mkdir(join(project, 'config'), { recursive: true });
    await writeFile(join(project, 'package.json'), JSON.stringify({
      name: 'first-pump',
      private: true,
      version: '0.0.0',
      type: 'module',
      description: 'Release-gate Saturn workspace',
      saturn: { title: 'First pump' },
    }, null, 2) + '\n');
    await writeFile(join(project, 'src', 'plant.ts'), plantSource);
    await writeFile(join(project, 'docs', 'operations.md'), '# Operations\n\nWorkspace-owned documentation.\n');
    await writeFile(join(project, 'config', 'area.json'), '{"area":"circulation"}\n');

    const passwords = {
      engineer: randomBytes(24).toString('base64url'),
      operator: randomBytes(24).toString('base64url'),
      viewer: randomBytes(24).toString('base64url'),
    };
    app = await startWorkspaceTestServer({
      project,
      data: join(directory, 'runtime.sqlite3'),
      password: passwords.engineer,
    });
    app.auth.seed('operator', passwords.operator, 'operator');
    app.auth.seed('viewer', passwords.viewer, 'viewer');

    engineerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    assert.equal((await engineerContext.request.get(app.origin + '/plant/api/workspace')).status(), 401, 'Workspace source requires authentication');

    const page = await engineerContext.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(app.origin);
    await page.locator('.export-options').evaluate(menu => menu.open = true);
    await page.locator('#server-open').click();
    await page.locator('#server-load').click();
    await page.waitForFunction(() => document.getElementById('server-error')?.textContent?.includes('Войдите'));

    const login = await engineerContext.request.post(app.origin + '/plant/api/login', {
      data: { user: 'engineer', password: passwords.engineer },
      headers: { Origin: app.origin },
    });
    assert.equal(login.status(), 200);

    const workspaceResponse = await engineerContext.request.get(app.origin + '/plant/api/workspace');
    assert.equal(workspaceResponse.status(), 200);
    const initialWorkspace = await workspaceResponse.json();
    assert.match(initialWorkspace.id, /^sha256:[a-f0-9]{64}$/);
    assert.equal(initialWorkspace.sourceRevision, null, 'Git provenance is optional; runtime identity is the artifact hash');
    assert(initialWorkspace.files['src/plant.ts'].includes("simulation('P-101'"));
    assert(initialWorkspace.files['docs/operations.md']);

    await page.locator('#server-load').click();
    await page.waitForFunction(() => document.getElementById('studio-shell')?.dataset.serverProject === 'true');
    assert.equal(await page.locator('#file-tree [data-file="src/plant.ts"]').count(), 1);
    assert.equal(await page.locator('#file-tree [data-file="docs/operations.md"]').count(), 1);
    assert((await page.locator('#revision-applied').textContent())?.trim() !== '—');

    const initialSession = await (await engineerContext.request.get(app.origin + '/plant/api/session')).json();
    assert.equal(initialSession.desired, initialWorkspace.id);
    assert.equal(initialSession.frame.revision, initialWorkspace.id);

    await page.locator('[data-file="src/plant.ts"]').click();
    const source = page.locator('#studio-editor .cm-content');
    await source.click();
    await source.press('ControlOrMeta+End');
    await page.keyboard.insertText('\n// workspace edit survives independently from runtime\n');
    await page.waitForFunction(() => !document.getElementById('server-save')?.hasAttribute('disabled'));

    await page.locator('#server-save').click();
    await page.waitForFunction(previous => {
      const origin = document.getElementById('file-origin')?.textContent ?? '';
      return origin.includes('Workspace') && !origin.includes(previous.slice(0, 12));
    }, initialWorkspace.id);

    const savedWorkspace = await (await engineerContext.request.get(app.origin + '/plant/api/workspace')).json();
    assert.notEqual(savedWorkspace.id, initialWorkspace.id, 'Saving source creates a new build identity');
    assert((await readFile(join(project, 'src', 'plant.ts'), 'utf8')).includes('workspace edit survives'));
    const beforeDeploy = await (await engineerContext.request.get(app.origin + '/plant/api/session')).json();
    assert.equal(beforeDeploy.desired, initialWorkspace.id, 'Saving workspace does not publish it');
    assert.equal(beforeDeploy.frame.revision, initialWorkspace.id, 'Saving workspace does not mutate the running artifact');

    await page.waitForFunction(() => !document.getElementById('server-publish')?.hasAttribute('disabled'));
    await page.locator('#server-publish').click();
    await page.waitForFunction(expected => {
      const shell = document.getElementById('studio-shell');
      return shell?.dataset.telemetry === 'live' &&
        document.getElementById('revision-applied')?.textContent?.includes(expected.slice(0, 7));
    }, savedWorkspace.id);

    const deployed = await (await engineerContext.request.get(app.origin + '/plant/api/session')).json();
    assert.equal(deployed.desired, savedWorkspace.id);
    assert.equal(deployed.frame.revision, savedWorkspace.id);
    const artifact = await (await engineerContext.request.get(app.origin + '/plant/api/artifact')).json();
    assert.equal(artifact.hash, savedWorkspace.id, 'Runtime exposes the exact deployed BuildArtifact');

    operatorContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const operatorLogin = await operatorContext.request.post(app.origin + '/plant/api/login', {
      data: { user: 'operator', password: passwords.operator },
      headers: { Origin: app.origin },
    });
    assert.equal(operatorLogin.status(), 200);
    assert.equal((await operatorContext.request.get(app.origin + '/plant/api/workspace')).status(), 403, 'Operator cannot read engineering source');
    const operatorPage = await operatorContext.newPage();
    await operatorPage.goto(app.origin);
    await operatorPage.waitForFunction(() => {
      const shell = document.getElementById('studio-shell');
      return shell?.dataset.role === 'operator' && shell.dataset.runtimeOnly === 'true';
    });
    assert(!(await operatorPage.locator('#files-toggle').isVisible()), 'Operator does not see workspace files');
    assert(!(await operatorPage.locator('#studio-code').isVisible()), 'Operator does not see source editor');
    assert.equal(await operatorPage.locator('#revision-applied').textContent(), savedWorkspace.id.slice(0, 7));

    viewerContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const viewerLogin = await viewerContext.request.post(app.origin + '/plant/api/login', {
      data: { user: 'viewer', password: passwords.viewer },
      headers: { Origin: app.origin },
    });
    assert.equal(viewerLogin.status(), 200);
    assert.equal((await viewerContext.request.get(app.origin + '/plant/api/workspace')).status(), 403, 'Viewer cannot read engineering source');
    const viewerPage = await viewerContext.newPage();
    await viewerPage.goto(app.origin);
    await viewerPage.waitForFunction(() => {
      const shell = document.getElementById('studio-shell');
      return shell?.dataset.role === 'viewer' && shell.dataset.runtimeOnly === 'true';
    });
    assert(!(await viewerPage.locator('#files-toggle').isVisible()));
    assert(!(await viewerPage.locator('#studio-code').isVisible()));

    assert.deepEqual(errors, []);
    console.log('PASS: filesystem workspace -> immutable BuildArtifact -> runtime; save is not deploy; engineer/operator/viewer boundaries.');
  } finally {
    await viewerContext?.close();
    await operatorContext?.close();
    await engineerContext?.close();
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
}
