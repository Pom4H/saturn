import { project, simulation, system } from '@saturn/core';

const water = system('water', 'Water');
const pump = simulation('P-101', 'pump', {
  system: 'water',
  at: { x: 100, y: 120 },
});

const installation = project('consumer', {
  title: 'Consumer',
  description: 'External TypeScript consumer',
  systems: [water],
  simulations: [pump],
  signals: [],
  alarms: [],
  reports: [],
});

if (pump.id !== 'P-101' || pump.kind !== 'pump' || !pump.flow || installation.simulations[0].id !== 'P-101') {
  throw new Error('@saturn/core public contract failed');
}

if (false) {
  // Internal Project IR must not leak into completion/public authoring.
  // @ts-expect-error hidden implementation detail
  pump.node;

  // @ts-expect-error unknown model kind
  simulation('bad', 'definitely-not-a-model', { system: 'water', at: { x: 0, y: 0 } });

  // @ts-expect-error wrong parameter name is rejected from model metadata
  simulation('bad-params', 'pump', { system: 'water', at: { x: 0, y: 0 }, parameters: { inertai: 2 } });
}

console.log('@saturn/core consumer passed');
