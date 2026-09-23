import test from 'node:test';
import assert from 'node:assert/strict';
import { compileProject } from '../compiler';
import { Kernel } from '../kernel';
import { installEquipment, visualFrame } from '../equipment';
import { terminals, footprint } from '../ports';
import { processSymbolGeometry } from '../../src/equipment-geometry';
import { numeric } from '../../src/runtime/protocol';

test('native process footprints and terminal anchors are the original SVG coordinates', () => {
  assert.deepEqual(footprint('pump'), { width: 220, height: 170 });
  assert.deepEqual(footprint('reservoir'), { width: 170, height: 230 });
  assert.deepEqual(footprint('valve'), { width: 160, height: 164 });
  assert.equal(terminals('pump').outlet.side, 'up');
  assert.equal(terminals('pump').outlet.x, processSymbolGeometry.pump.outlet.x);
  assert.equal(terminals('pump').inlet.y, 96);
  assert.equal(terminals('reservoir').outlet.y, 184);
});
test('canonical pipe animation uses actual source-terminal quality, including zero and missing observations', () => {
  const project = compileProject({ 'plant.ts': `import { project, system, simulation, pipe } from '@saturn/core';
    const water = system('water', 'Water');
    const pump = simulation('P', 'pump', { system: water.id, at: { x: 400, y: 80 } });
    const tank = simulation('T', 'reservoir', { system: water.id, at: { x: 60, y: 400 } });
    export default project('pipe-observation', { title: 'Observation', description: 'Read-only signal projection test', systems: [water], simulations: [pump, tank],
      connections: [pipe('return', pump.ports.outlet, tank.ports.inlet)], signals: [], alarms: [], reports: [] });` });
  installEquipment();
  const frame = new Kernel(project, 'test', 'test', 0).frame();
  const observed = () => numeric(visualFrame(project, frame).flows.return);
  assert.equal(observed(), frame.samples['P.flow'].value);
  frame.samples['P.flow'] = { value: 0, quality: 'good', time: frame.time };
  assert.equal(observed(), 0);
  frame.samples['P.flow'] = { value: 2, quality: 'stale', time: frame.time };
  assert.equal(observed(), null);
  delete frame.samples['P.flow'];
  assert.equal(observed(), null);
});
