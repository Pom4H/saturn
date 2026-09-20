import { cable, pipe, project, simulation, system } from '@saturn/core';

const water = system('water', 'Water');
const tank = simulation('T-101', 'reservoir', {
  system: 'water',
  at: { x: 20, y: 120 },
});
const pump = simulation('P-101', 'pump', {
  system: 'water',
  at: { x: 260, y: 120 },
});
const separator = simulation('SEP-101', 'separator', {
  system: 'water',
  at: { x: 520, y: 120 },
});
const generator = simulation('GEN', 'alternator', {
  system: 'water',
  at: { x: 20, y: 360 },
});
const transformer = simulation('TR', 'transformer', {
  system: 'water',
  at: { x: 260, y: 360 },
});
const supply = simulation('PSU', 'dc-supply', {
  system: 'water',
  at: { x: 520, y: 360 },
});

const suction = pipe('suction', tank.ports.outlet, pump.ports.inlet);
const feeder = cable('feeder', generator.ports.output, transformer.ports.primary, { medium: 'power' });

const installation = project('consumer', {
  title: 'Consumer',
  description: 'External TypeScript consumer',
  systems: [water],
  simulations: [tank, pump, separator, generator, transformer, supply],
  connections: [suction, feeder],
  signals: [],
  alarms: [],
  reports: [],
});

if (
  pump.id !== 'P-101'
  || pump.kind !== 'pump'
  || pump.ports.inlet.port !== 'inlet'
  || !pump.flow
  || installation.simulations[0].id !== 'T-101'
) {
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

  // Separator outlet carries steam; pump inlet accepts water.
  // @ts-expect-error incompatible fluid media
  pipe('steam-to-water', separator.ports.outlet, pump.ports.inlet);

  // Both are power terminals, but their electrical families are incompatible.
  // @ts-expect-error drive power cannot be wired directly to a dc24 terminal
  cable('drive-to-dc24', generator.ports.output, supply.ports.plus, { medium: 'power' });
}

console.log('@saturn/core consumer passed');
