import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const directory = await mkdtemp(resolve('.canonical-source-'));
try {
  const entry = `${directory}/test.cjs`;
  await build({ stdin: { contents: `export * from './site/project-source'; export { examples, emptySource } from './site/shell-projects'; export { compileProject } from './plant/compiler';`, loader: 'ts', resolveDir: process.cwd() }, outfile: entry, bundle: true, platform: 'node', format: 'cjs', packages: 'external' });
  const m = createRequire(import.meta.url)(entry);
  for (const source of [m.examples.pump.source, m.examples.thermal.source, m.emptySource]) {
    const compiled = m.compile(source);
    assert.deepEqual(compiled.project, m.compileProject({ 'plant.ts': source }), 'Exactly the canonical compiler output');
    assert.equal(compiled.scene.links.length, 0, 'No legacy edges');
    assert.doesNotMatch(source, /@scada\/core|\bconnect\s*\(/);
  }
  const source = m.examples.pump.source, c = m.compile(source);
  assert.deepEqual(c.project.connections.map(w => [w.id, w.medium]), [['PIPE-01', 'pipe'], ['PIPE-02', 'pipe'], ['PIPE-03', 'pipe'], ['CABLE-01', 'power']]);
  const aliased = source.replace('system, simulation,', 'system, simulation as sim,').replaceAll('= simulation(', '= sim(');
  assert(m.editable(m.compile(aliased), 'P-01', 'x'), 'Imported aliases keep exact edit spans');
  assert(m.compile(m.appendEquipment(m.emptySource, 'plant_pump', 100, 100)).project.devices.length === 1);
  const changes = m.patchFields(source, 'P-01', { x: 430, y: 290 });
  const changed = m.applyChanges(source, changes);
  assert.equal(changes.length, 2);
  assert.equal(changed, source.replace('x: 330, y: 268', 'x: 430, y: 290'), 'Only authored numeric spans change');
  assert.deepEqual(m.compile(changed).project.connections, c.project.connections, 'Coordinates never rewrite pipe/cable definitions');
  const preview = m.previewProject(c.project, 'P-01', 430, 290);
  for (const id of ['PIPE-01', 'CABLE-01']) assert.notDeepEqual(preview.connections.find(w=>w.id===id).points, c.scene.connections.find(w=>w.id===id).points, `${id} follows the moved pump`);
  const frame = m.previewFrame(c), next = m.previewFrame(c, true);
  assert(next.seq > frame.seq, 'Preview runs the production Kernel');
  assert.throws(() => m.compile(source.replace('drive.ports.out, pump.ports.drive', 'tank.ports.outlet, pump.ports.drive')));
  assert.throws(() => m.compile(source.replace('tank.ports.outlet, pump.ports.inlet', 'drive.ports.out, pump.ports.inlet')));
  assert.throws(() => m.compile('import { tank, connect } from "@scada/core";'));
  const removed = m.removeObject(source, 'CABLE-01');
  assert.equal(m.compile(removed).project.connections.length, 3);
  const restored = m.appendConnection(removed, { node:'PSU-01', port:'out' }, { node:'P-01', port:'drive' });
  assert.equal(m.compile(restored).project.connections.filter(w=>w.medium==='power').length, 1);
  assert.match(restored, /cable\("CABLE-1"/);
  const added = m.appendEquipment(source, 'plant_pump', 450, 480);
  const newId = m.compile(added).project.devices.at(-1).id;
  assert.equal(m.compile(added).project.devices.length, 6);
  assert.equal(m.compile(m.removeObject(added,newId)).project.devices.length, 5);
  assert(!m.compile(m.removeObject(source,'P-01')).project.connections.some(w=>w.from.device==='P-01'||w.to.device==='P-01'));
  const completions = m.dslCompletions('',0,c).map(x=>x.label);
  assert(completions.includes('pipe') && completions.includes('cable') && !completions.includes('connect'));
  for (const name of await readdir('site')) if (name.endsWith('.ts')) {
    const text=await readFile(`site/${name}`,'utf8');
    assert.doesNotMatch(text, /from\s*['"]\.\.\/src\/(?:source|completion)['"]|@scada\/core/, `${name}: no legacy product entrypoint`);
  }
  console.log('PASS: one canonical compiler; pipe/cable topology and validation; exact numeric edits; live physical routes; add/delete; canonical completions; no legacy site compiler.');
} finally { await rm(directory, { recursive:true, force:true }); }
