import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import * as core from '../src/core';
import { ComponentRegistry, defineSchematicElement, type ComponentDefinition, type ComponentProjection, type Port } from '../src/elements/model';
import { registry, pump } from '../src/elements/core-elements';
import { compile, patchFields, applyChanges } from '../src/source';
import { observedFlows } from '../src/view';
import type { RuntimeFrame } from '../src/runtime/protocol';
import { booster } from '../examples/diagram/projects';
import { simulate } from '../examples/diagram/simulation';

const withoutVisual = (projection: ComponentProjection) => {
  const { visual, ...data } = projection;
  return JSON.parse(JSON.stringify(data)) as unknown;
};
test('every migrated component preserves its pre-migration schematic contract', () => {
  const expected = JSON.parse(readFileSync('tests/fixtures/component-projections.json', 'utf8')) as Record<string, unknown>;
  assert.equal(Object.keys(expected).length, 9);
  for (const [kind, shape] of Object.entries(expected)) assert.deepEqual(withoutVisual(registry.schematic(kind)), shape, kind);
});
test('compiler and geometry aliases resolve to the same canonical equipment definition', () => {
  assert.equal(core.componentRegistry, registry);
  assert.equal(registry.get('pump'), registry.get('process.pump.centrifugal'));
  assert.equal(registry.get('filter'), registry.get('process.filter.inline'));
  assert.equal(registry.schematic('pump').fields, registry.get('pump').schematic?.fields);
  assert.equal(registry.schematic('pump').visual, registry.get('pump').visual);
  assert.equal(registry.schematic('pump').signals.rpm.unit, registry.get('pump').signals.rpm.unit);
  assert.equal('catalog' in core, false);
  assert.equal('registerComponent' in core, false);
  assert.equal('simulate' in core, false);
});
test('derived metadata cannot become a mutable second source of truth', () => {
  const projection = registry.schematic('pump');
  assert.equal(projection, registry.schematic('pump'));
  assert(Object.isFrozen(projection));
  assert.equal(Reflect.set(projection.fields.x, 'default', 999), false);
  assert.equal(Reflect.set(projection.signals.rpm, 'unit', 'wrong'), false);
  assert.equal(projection.fields.x.default, 100);
});
test('new schematic port direction is derived from its canonical normal', () => {
  const definition: ComponentDefinition = {
    ...pump, type: 'test.directional-pump',
    ports: p => pump.ports(p).map((port): Port => port.id === 'OUT' ? { ...port, normal: [1, 0, 0] } : port),
    schematic: { ...pump.schematic!, kind: 'directionalPump', anchors: { inlet: { port: 'IN' }, outlet: { port: 'OUT' } } },
  };
  const local = new ComponentRegistry().register(definition);
  assert.equal(local.schematic('directionalPump').ports.outlet.direction, 'right');
  assert.equal(local.schematic('directionalPump').ports.outlet.role, 'out');
});
test('invalid anchors and failed packs never partially install', () => {
  const local = new ComponentRegistry().register(pump);
  const good: ComponentDefinition = { ...pump, type: 'test.other-pump', schematic: { ...pump.schematic!, kind: 'otherPump' } };
  const bad: ComponentDefinition = { ...pump, type: 'test.bad-pump', schematic: { ...pump.schematic!, kind: 'badPump', anchors: { broken: { port: 'MISSING' } } } };
  assert.throws(() => local.register(bad), /Invalid schematic port/);
  assert.equal(local.has('badPump'), false);
  assert.throws(() => local.registerPack({ id: '@test/pumps', version: '1.0.0', title: 'Pumps', elements: [good, pump] }), /Duplicate/);
  assert.equal(local.has('otherPump'), false);
  assert.equal(local.list().length, 1);
});
test('the native schematic constructor snapshots caller-owned port definitions', () => {
  const ports = { inlet: { x: 0, y: 20, direction: 'left' as const, role: 'in' as const } };
  const definition = defineSchematicElement('sampleUnit', { version: '1.0.0', label: 'Sample', width: 80, height: 40, fields: {}, ports });
  ports.inlet.x = 999;
  const local = new ComponentRegistry().register(definition);
  assert.equal(local.schematic('sampleUnit').ports.inlet.x, 0);
  assert.equal(local.get('sampleUnit').ports({})[0].position[0], 0);
});
test('two-way field edits preserve comments, literals and unrelated source', () => {
  const text = 'import { pump } from "@scada/core";\n// keep this comment\nconst p = pump("P-1", { x: 10, y: 20, rpm: 1500 });\n';
  const changed = applyChanges(text, patchFields(text, 'P-1', { x: 310, y: 220 }));
  assert.equal(changed, text.replace('x: 10, y: 20', 'x: 310, y: 220'));
  const node = compile(changed).scene.nodes[0];
  assert.equal(node.props.x, 310); assert.equal(node.props.y, 220);
  const formula = text.replace('x: 10', 'x: 5 * 2');
  assert.throws(() => patchFields(formula, 'P-1', { x: 500 }), /вычисляется выражением/);
});
test('demo simulation is opt-in and live observations take precedence', () => {
  const scene = compile(booster).scene, preview = simulate(scene);
  assert.equal(observedFlows(scene, null).size, 0);
  assert.equal(observedFlows(scene, null, preview), preview.flows);
  assert.equal(preview.flows.get('P-101'), 9.120000000000001);
  const frame: RuntimeFrame = { runId: 'test', seq: 1, simTimeMs: 0, timestamp: 0, type: 'snapshot', events: [], equipment: {}, flows: Object.fromEntries(scene.links.map(link => [link.id, { type: 'number', value: 42, unit: 'm3/h', timestamp: 0, quality: 'good' }])) };
  for (const link of scene.links) assert.equal(observedFlows(scene, frame, preview).get(link.id), 42);
});
test('library source contains no demo dependencies or legacy registry declarations', () => {
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]);
  for (const path of walk('src').filter(path => path.endsWith('.ts'))) {
    const text = readFileSync(path, 'utf8');
    assert(!/from\s*['"][^'"]*examples\//.test(text), `Demo dependency: ${path}`);
    assert(!/export\s+const\s+catalog\b|export\s+interface\s+Definition\b|export\s+interface\s+PortSpec\b/.test(text), `Duplicate registry declaration: ${path}`);
  }
  for (const path of ['src/examples.ts', 'src/main.ts', 'src/standalone.ts', 'plant/demo', 'lab3d', 'src/next', 'site/starter.ts', 'site/landing-project.ts', 'site/typescript-example.ts', 'site/model.ts', 'site/scene.ts', 'site/project-context.ts']) assert.equal(existsSync(path), false, path);
  for (const path of ['examples/diagram/projects.ts', 'examples/diagram/simulation.ts', 'examples/plant/files.ts', 'examples/elements-lab/main.ts', 'examples/pumping/files.ts', 'examples/landing/project.ts', 'examples/pump-bank/files.ts', 'examples/hydraulic-loop/model.ts', 'examples/diagram/shell-projects.ts', 'examples/pump-bank/context.ts']) assert(existsSync(path), path);
});
