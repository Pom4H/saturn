import { alarm, control, gt, pipe, project, report, simulation, system } from '@saturn/core';

// Isolated training model: normalized values, no equipment driver or safety logic.
export const water = system('water', 'Насосный стенд');
export const drive = control('DRIVE', {
  title: 'P-101 · скорость насоса', system: water.id,
  min: 0, max: 1, initial: 0.72, rate: 0.5, step: 0.01, unit: 'отн.',
});
export const tank = simulation('TK-101', 'reservoir', {
  system: water.id, at: { x: 80, y: 180 },
  inputs: { inflow: 0.1, demand: 0.1 }, parameters: { initialLevel: 0.7 },
});
export const pump = simulation('P-101', 'pump', {
  system: water.id, at: { x: 380, y: 220 },
  inputs: { voltage: drive.value }, parameters: { inertia: 0.5 },
});
export const valve = simulation('V-101', 'motor-valve', {
  system: water.id, at: { x: 680, y: 180 }, inputs: { demand: 0.8 },
});

export const lowFlow = alarm('low-flow', {
  title: 'P-101: низкий расход', signal: gt(0.3, pump.flow),
  above: 0.5, clearBelow: 0.1, delay: 1000, priority: 'warning',
});
export const flowHistory = report('pump-flow', {
  title: 'Расход насоса P-101', signals: [pump.flow], window: 60_000,
  on: { workflow_dispatch: {} },
  sql: `SELECT time, CASE WHEN quality = 'good' THEN value ELSE NULL END AS flow
        FROM samples WHERE signal = 'P-101.flow' ORDER BY time`,
  columns: [{ key: 'time', title: 'Время' }, { key: 'flow', title: 'Расход', unit: 'отн.' }],
  chart: { x: 'time', y: 'flow', type: 'line', title: 'Расход за минуту', unit: 'отн.' },
});

export default project('operator-pump', {
  title: 'Насосный стенд',
  description: 'Учебная симуляция. Без подключения к оборудованию. Не расчёт гидравлики.',
  systems: [water], simulations: [tank, pump, valve], controls: [drive],
  connections: [pipe('suction', tank.ports.outlet, pump.ports.inlet), pipe('delivery', pump.ports.outlet, valve.ports.inlet)],
  signals: [], alarms: [lowFlow], reports: [flowHistory],
});
