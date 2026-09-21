import { project, simulation, system } from '@saturn/core';

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
