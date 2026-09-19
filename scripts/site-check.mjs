import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadSiteModule } from './site-build.mjs';
const [{ HydraulicLoop }, { serverAppUrl }, { starter }] = await Promise.all(['model', 'connection', 'starter'].map(loadSiteModule));
const { bankCounts, bankExample } = await loadSiteModule('typescript-example');
const { projectContext } = await loadSiteModule('project-context');
const loop = new HydraulicLoop();
for (let i = 0; i < 36000; i++) {
  if (i % 600 === 0) { loop.target = (i / 600 % 5) / 4; loop.valve = i % 1200 ? .28 : 1; }
  const previousLevel = loop.left;
  loop.step(1 / 60);
  assert(Math.abs(loop.left - previousLevel - (loop.inlet - loop.outlet) / 60) < 1e-10);
  assert(Math.abs(loop.left + loop.right - loop.totalVolume) < 1e-10);
  assert(loop.left >= 0 && loop.left <= loop.capacity && loop.right >= 0 && loop.right <= loop.capacity);
  assert(Number.isFinite(loop.flow) && loop.flow >= 0 && Number.isFinite(loop.pressure));
}
loop.reset(); loop.target = 0; const initial = loop.rpm; loop.step(1 / 60);
assert(loop.rpm > 0 && loop.rpm < initial, 'Motor must slow with inertia');
for (let i = 0; i < 1200; i++) loop.step(1 / 60);
assert(loop.rpm < 1 && loop.flow < .01);
const open = new HydraulicLoop(), closed = new HydraulicLoop(); closed.valve = .28;
for (let i = 0; i < 1200; i++) { open.step(1 / 60); closed.step(1 / 60); }
assert(closed.left > open.left + .1, 'Valve restriction must change reservoir levels');
assert.equal(serverAppUrl('https://example.com'), 'https://example.com/plant/login');
assert.equal(serverAppUrl('http://localhost:4176/plant/app/'), 'http://localhost:4176/plant/login');
assert.equal(serverAppUrl('https://example.com/custom/login'), 'https://example.com/custom/login');
for (const bad of ['javascript:alert(1)', 'ftp://example.com', 'https://user:pass@example.com', 'https://example.com/?token=x', 'not-a-url']) assert.throws(() => serverAppUrl(bad));
const dir = await mkdtemp(join(tmpdir(), 'saturn-site-check-'));
try {
  await build({ entryPoints: ['plant/compiler.ts'], outfile: join(dir, 'compiler.cjs'), bundle: true, format: 'cjs', platform: 'node', target: 'es2022' });
  const { compileProject } = (await import(pathToFileURL(join(dir, 'compiler.cjs')))).default;
  const project = compileProject(starter);
  assert.equal(project.id, 'first-pump'); assert.equal(project.simulations.length, 1); assert.equal(project.views.length, 1); assert.equal(project.controls.length, 1);
  for (const count of bankCounts) {
    const example = bankExample(count), compiled = compileProject(example.files);
    assert.equal(example.files['equipment.ts'], example.source);
    assert.deepEqual(compiled.simulations.map(node => node.id), Array.from({ length: count }, (_, i) => `PUMP-${i + 1}`));
    assert(compiled.simulations.every(node => node.parameters.inertia === 1.6));
    assert.equal(compiled.views[0].bindings.flow.args.length, count, 'Operator view must aggregate the entire bank');
  }
  assert.throws(() => compileProject({ ...starter, 'views.ts': starter['views.ts'].replace('pump.flow', 'pump.flwo') }), /Unknown field: flwo/);
  const context = projectContext(4);
  const reference = JSON.parse(context.match(/```json\n([\s\S]*?)\n```/)[1]);
  assert.equal(compileProject(reference).simulations.length, 4, 'Project context must contain the matching importable example');
  console.log('PASS: conserved/bounded simulation, motor inertia, causal valve, connection URLs, downloadable DSL compiled by Saturn.');
  console.log('PASS: 1/4/8-pump examples compile with matching IDs and operator bindings; the shown typo is rejected.');
  console.log('PASS: the example embedded in the portable project context compiles.');
} finally { await rm(dir, { recursive: true, force: true }); }

// The landing Shell must keep example drafts and promoted projects independent.
const shell = await loadSiteModule('shell-projects');
const workspace = shell.createWorkspace();
const modified = workspace.drafts.pump.replace('rpm: 1850', 'rpm: 2100');
shell.updateSource(workspace, modified);
shell.createProject(workspace, 'Станция Север', modified, 'project-1');
shell.updateSource(workspace, modified.replace('rpm: 2100', 'rpm: 2300'));
assert(workspace.drafts.pump.includes('rpm: 2100'));
assert(shell.currentDocument(workspace).source.includes('rpm: 2300'));
assert.equal(shell.parseWorkspace(JSON.stringify(workspace)).projects[0].title, 'Станция Север');
assert.throws(() => shell.parseWorkspace(JSON.stringify({ ...workspace, projects: [...workspace.projects, ...workspace.projects] })));
assert.throws(() => shell.parseWorkspace(JSON.stringify({ ...workspace, active: { kind: 'project', id: 'missing' } })));
assert.throws(() => shell.createProject(workspace, '   ', modified));
console.log('PASS: promoted projects preserve exact source and remain independent of example drafts; workspace validation rejects invalid references.');
