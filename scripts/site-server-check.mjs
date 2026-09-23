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
  const raw = {
    name: 'raw',
    setup(plugin) {
      plugin.onResolve({ filter: /\?raw$/ }, args => ({
        path: resolve(args.resolveDir, args.path.slice(0, -4)),
        namespace: 'raw',
      }));
      plugin.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({
        contents: await readFile(args.path, 'utf8'),
        loader: 'text',
      }));
    },
  };

  await build({
    entryPoints: ['scripts/site-workspace-server.ts'],
    outfile: '.plant/site-workspace-server.mjs',
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    plugins: [raw],
  });
  await buildSite('dist/plant/site', 'ide');

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

    const loginResponse = await engineerContext.request.post(app.origin + '/plant/api/login', {
      data: { user: 'engineer', password: passwords.engineer },
      headers: { Origin: app.origin },
    });
    assert.equal(loginResponse.status(), 200);
    const login = await loginResponse.json();
    const sessionCookie = (await engineerContext.cookies(app.origin + '/plant/')).find(cookie => cookie.name === 'scada_session');
    assert(sessionCookie?.httpOnly, 'Engineer login creates the real HttpOnly Saturn session cookie');

    const workspaceResponse = await engineerContext.request.get(app.origin + '/plant/api/workspace');
    assert.equal(workspaceResponse.status(), 200);
    const initialWorkspace = await workspaceResponse.json();
    assert.match(initialWorkspace.id, /^sha256:[a-f0-9]{64}$/);
    assert.equal(initialWorkspace.sourceRevision, null, 'Git provenance is optional; runtime identity is the artifact hash');
    assert(initialWorkspace.files['src/plant.ts'].includes("simulation('P-101'"));
    assert(initialWorkspace.files['docs/operations.md']);

    const initialSession = await (await engineerContext.request.get(app.origin + '/plant/api/session')).json();
    assert.equal(initialSession.desired, initialWorkspace.id);
    assert.equal(initialSession.frame.revision, initialWorkspace.id);

    const editedFiles = {
      ...initialWorkspace.files,
      'src/plant.ts': initialWorkspace.files['src/plant.ts'] + '\n// workspace edit survives independently from runtime\n',
    };
    const saveResponse = await engineerContext.request.post(app.origin + '/plant/api/workspace/save', {
      data: { files: editedFiles, expected: initialWorkspace.id },
      headers: { Origin: app.origin, 'X-CSRF-Token': login.csrf },
    });
    assert.equal(saveResponse.status(), 200);
    const savedWorkspace = await saveResponse.json();
    assert.notEqual(savedWorkspace.id, initialWorkspace.id, 'Workspace save creates a new immutable BuildArtifact identity');
    assert.match(savedWorkspace.id, /^sha256:[a-f0-9]{64}$/);
    assert((await readFile(join(project, 'src', 'plant.ts'), 'utf8')).includes('workspace edit survives'));

    const beforeDeploy = await (await engineerContext.request.get(app.origin + '/plant/api/session')).json();
    assert.equal(beforeDeploy.desired, initialWorkspace.id, 'Saving workspace does not publish it');
    assert.equal(beforeDeploy.frame.revision, initialWorkspace.id, 'Saving workspace does not mutate the running artifact');

    const deployResponse = await engineerContext.request.post(app.origin + '/plant/api/deploy', {
      data: { expected: beforeDeploy.desired },
      headers: { Origin: app.origin, 'X-CSRF-Token': login.csrf },
    });
    assert.equal(deployResponse.status(), 200);
    const deployed = await deployResponse.json();
    assert.equal(deployed.desired, savedWorkspace.id);
    assert.equal(deployed.frame.revision, savedWorkspace.id);

    const artifactResponse = await engineerContext.request.get(app.origin + '/plant/api/artifact');
    assert.equal(artifactResponse.status(), 200);
    const artifact = await artifactResponse.json();
    assert.equal(artifact.hash, savedWorkspace.id, 'Runtime exposes the exact deployed BuildArtifact');

    operatorContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const operatorLogin = await operatorContext.request.post(app.origin + '/plant/api/login', {
      data: { user: 'operator', password: passwords.operator },
      headers: { Origin: app.origin },
    });
    assert.equal(operatorLogin.status(), 200);
    assert.equal((await operatorContext.request.get(app.origin + '/plant/api/workspace')).status(), 403, 'Operator cannot read engineering source');
    const operatorPage = await operatorContext.newPage(), operatorErrors = [];
    operatorPage.on('pageerror', error => operatorErrors.push(error.message));
    await operatorPage.goto(app.origin);
    await operatorPage.waitForFunction(expected => {
      const shell = document.getElementById('studio-shell');
      return shell?.dataset.role === 'operator' &&
        shell.dataset.runtimeOnly === 'true' &&
        document.getElementById('revision-applied')?.textContent?.includes(expected.slice(0, 7));
    }, savedWorkspace.id);
    assert(!(await operatorPage.locator('#files-toggle').isVisible()), 'Operator does not see workspace files');
    assert(!(await operatorPage.locator('#studio-code').isVisible()), 'Operator does not see source editor');
    assert.deepEqual(operatorErrors, []);

    viewerContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const viewerLogin = await viewerContext.request.post(app.origin + '/plant/api/login', {
      data: { user: 'viewer', password: passwords.viewer },
      headers: { Origin: app.origin },
    });
    assert.equal(viewerLogin.status(), 200);
    assert.equal((await viewerContext.request.get(app.origin + '/plant/api/workspace')).status(), 403, 'Viewer cannot read engineering source');
    const viewerPage = await viewerContext.newPage(), viewerErrors = [];
    viewerPage.on('pageerror', error => viewerErrors.push(error.message));
    await viewerPage.goto(app.origin);
    await viewerPage.waitForFunction(expected => {
      const shell = document.getElementById('studio-shell');
      return shell?.dataset.role === 'viewer' &&
        shell.dataset.runtimeOnly === 'true' &&
        document.getElementById('revision-applied')?.textContent?.includes(expected.slice(0, 7));
    }, savedWorkspace.id);
    assert(!(await viewerPage.locator('#files-toggle').isVisible()));
    assert(!(await viewerPage.locator('#studio-code').isVisible()));
    assert.deepEqual(viewerErrors, []);

    console.log('PASS: filesystem workspace -> immutable BuildArtifact -> runtime; save is not deploy; operator/viewer cannot read source.');
  } finally {
    await viewerContext?.close();
    await operatorContext?.close();
    await engineerContext?.close();
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
}
