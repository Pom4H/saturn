import { simulation, bank, aggregate } from '../dsl';
const pump = simulation('P', 'pump', { system: 'cooling', at: { x: 0, y: 0 }, inputs: { voltage: 1 }, parameters: { inertia: 2 } });
const flow = pump.flow;
// @ts-expect-error Signals are inferred from installed model metadata.
pump.pressure;
// @ts-expect-error Unknown model parameter.
simulation('P2', 'pump', { system: 'cooling', at: { x: 0, y: 0 }, parameters: { inertai: 2 } });
// @ts-expect-error An expression, not a string, supplies an input.
simulation('P3', 'pump', { system: 'cooling', at: { x: 0, y: 0 }, inputs: { voltage: 'wrong' } });
const channels = bank('C', 'channel', { system: 'core', at: { x: 0, y: 0 }, count: 4, columns: 2, pitch: { x: 200, y: 200 }, inputs: { flow } });
aggregate(channels, 'temperature');
// @ts-expect-error Aggregate output name is inferred as well.
aggregate(channels, 'rpm');
