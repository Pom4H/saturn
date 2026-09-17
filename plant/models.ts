import { AppError, type ModelSpec } from './types';
/** Models are trusted installed modules. All plant-specific wiring lives in DSL files. */
const registry = new Map<string, ModelSpec>();
export function registerModel(model: ModelSpec): void {
    if (registry.has(model.kind))
        throw new AppError(`Duplicate model: ${model.kind}`);
    registry.set(model.kind, model);
}
export function model(kind: string): ModelSpec { const m = registry.get(kind); if (!m)
    throw new AppError(`Unknown installed model: ${kind}`); return m; }
export const models = () => [...registry.values()];
const p = (value: number, min = 0, max = 100) => ({ default: value, min, max });
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const approach = (x: number, to: number, dt: number, tau: number) => x + (to - x) * (1 - Math.exp(-dt / Math.max(.02, tau)));
const installed = <const M extends Omit<ModelSpec, 'version'>>(m: M): M & {
    version: string;
} => { const definition = { ...m, version: '1.0.0' }; registerModel(definition); return definition; };
const supply = installed({ kind: 'supply', title: 'Электропитание', visual: 'generator', inputs: {}, parameters: { voltage: p(1, 0, 1.5) }, outputs: { voltage: 'отн.' },
    initialize: q => ({ voltage: q.voltage }), advance: (_s, _i, q) => ({ voltage: q.voltage }), observe: s => ({ ...s }) });
const pump = installed({ kind: 'pump', title: 'Циркуляционный насос', visual: 'pump', inputs: { voltage: 1, resistance: 1 }, parameters: { inertia: p(6, .1, 120), nominalFlow: p(1, .01, 100) }, outputs: { flow: 'отн.', rpm: 'об/мин', power: 'отн.' },
    initialize: () => ({ speed: 1, flow: 1 }), advance: (s, i, q, dt) => { const speed = approach(s.speed, clamp(i.voltage, 0, 1.5), dt, q.inertia); return { speed, flow: q.nominalFlow * speed / Math.max(.2, i.resistance) }; },
    observe: s => ({ flow: s.flow, rpm: s.speed * 1500, power: s.speed ** 3 }) });
/** Dimensionless feedback heat source, NOT neutron kinetics or a reactor operating model. */
const feedback = installed({ kind: 'feedback-source', title: 'Активная зона · агрегат', visual: 'reactor', inputs: { void: 0, temperature: 1, absorber: 0 }, parameters: { feedback: p(3, 0, 8), thermalFeedback: p(.35, 0, 4), response: p(4, .2, 60), initialPower: p(1, .001, 5) }, outputs: { power: 'отн.', rate: 'отн./с' },
    initialize: q => ({ power: q.initialPower, rate: 0 }), advance: (s, i, q, dt) => { const growth = q.feedback * Math.max(0, i.void - .2) - q.thermalFeedback * Math.max(0, i.temperature - 1) - 4 * clamp(i.absorber); const rate = (growth * s.power + .2 * (q.initialPower - s.power)) / q.response; return { power: clamp(s.power + dt * rate, 0, 100), rate }; },
    observe: s => ({ ...s }) });
/** Lumped energy balance dE = heatIn - heatRemoved. Damage changes hydraulic resistance. */
const channel = installed({ kind: 'channel', title: 'Топливный канал', visual: 'channel', inputs: { power: 1, flow: 1, inlet: .2 }, parameters: { capacity: p(6, .1, 100), transfer: p(1, .01, 10), boiling: p(.8, .2, 3), damageTemperature: p(2.4, 1, 10), damageRate: p(.06, 0, 2), initialTemperature: p(1, .2, 5) }, outputs: { temperature: 'отн.', void: 'доля', heat: 'отн.', damage: 'доля', resistance: 'отн.', release: 'отн.', energy: 'отн.', balance: 'отн.' },
    initialize: q => ({ temperature: q.initialTemperature, void: .12, heat: .8, damage: 0, energy: q.capacity * q.initialTemperature, release: 0, balance: 0 }),
    advance: (s, i, q, dt) => { const cooling = q.transfer * Math.max(0, i.flow) * Math.max(0, s.temperature - i.inlet) * (1 - .65 * s.damage); const heatIn = Math.max(0, i.power); const energy = Math.max(0, s.energy + dt * (heatIn - cooling)); const temperature = energy / q.capacity; const voidTarget = clamp((temperature - q.boiling) * .6 / Math.max(.2, i.flow), 0, .98); const damage = clamp(s.damage + dt * q.damageRate * Math.max(0, temperature - q.damageTemperature) ** 2); return { temperature, energy, heat: cooling, void: approach(s.void, voidTarget, dt, 1.5), damage, release: Math.max(0, damage - s.damage) / dt * temperature, balance: (energy - s.energy) - dt * (heatIn - cooling) }; },
    observe: s => ({ ...s, resistance: 1 + 6 * s.damage }) });
const separator = installed({ kind: 'separator', title: 'Барабан-сепаратор', visual: 'separator', inputs: { heat: 1, demand: 1 }, parameters: { capacity: p(8, .1, 100) }, outputs: { pressure: 'отн.', steam: 'отн.', level: '%' },
    initialize: () => ({ pressure: 1, steam: 1, level: 70 }), advance: (s, i, q, dt) => { const steam = Math.min(Math.max(0, s.pressure), Math.max(0, i.demand)); return { pressure: Math.max(0, s.pressure + dt * (Math.max(0, i.heat) - steam) / q.capacity), steam, level: clamp(1 - .3 * s.pressure, .05, 1) * 100 }; }, observe: s => ({ ...s }) });
const turbine = installed({ kind: 'turbine', title: 'Турбина', visual: 'turbine', inputs: { steam: 1, load: 1 }, parameters: { inertia: p(12, .5, 120), efficiency: p(.9, 0, 1) }, outputs: { rpm: 'об/мин', electricity: 'отн.', exhaust: 'отн.' },
    initialize: () => ({ speed: 1, electricity: .9, exhaust: 1 }), advance: (s, i, q, dt) => { const speed = clamp(s.speed + dt * (Math.max(0, i.steam) - Math.max(.05, i.load) * s.speed) / q.inertia, 0, 3); return { speed, electricity: speed * Math.max(0, i.load) * q.efficiency, exhaust: Math.max(0, i.steam) * (1 - q.efficiency) }; }, observe: s => ({ rpm: s.speed * 1500, electricity: s.electricity, exhaust: s.exhaust }) });
const exchanger = installed({ kind: 'heat-exchanger', title: 'Конденсатор', visual: 'exchanger', inputs: { heat: .1, cooling: 1 }, parameters: { capacity: p(12, .1, 100), ambient: p(.2, 0, 1) }, outputs: { temperature: 'отн.', rejected: 'отн.' },
    initialize: q => ({ temperature: q.ambient, rejected: 0 }), advance: (s, i, q, dt) => { const rejected = Math.max(0, i.cooling) * (s.temperature - q.ambient); return { temperature: Math.max(q.ambient, s.temperature + dt * (i.heat - rejected) / q.capacity), rejected }; }, observe: s => ({ ...s }) });
const sensor = installed({ kind: 'sensor', title: 'Измерительный канал', visual: 'sensor', inputs: { value: 0 }, parameters: { lag: p(.2, .02, 30), bias: p(0, -100, 100) }, outputs: { value: 'отн.' }, initialize: () => ({ value: 0 }), advance: (s, i, q, dt) => ({ value: approach(s.value, i.value + q.bias, dt, q.lag) }), observe: s => ({ ...s }) });
const protection = installed({ kind: 'protection', title: 'Защита и поглотитель', visual: 'control', inputs: { temperature: 1, power: 1, demand: 0 }, parameters: { temperatureLimit: p(1.7, 1, 5), powerLimit: p(2, 1, 10), actuation: p(1, .05, 60) }, outputs: { insertion: 'доля', trip: 'лог.' },
    initialize: () => ({ insertion: 0, trip: 0 }), advance: (s, i, q, dt) => { const trip = s.trip || i.temperature > q.temperatureLimit || i.power > q.powerLimit || i.demand > .5 ? 1 : 0; return { trip, insertion: approach(s.insertion, trip, dt, q.actuation) }; }, observe: s => ({ ...s }) });
const structure = installed({ kind: 'structure', title: 'Реакторное здание', visual: 'structure', inputs: { release: 0 }, parameters: { capacity: p(12, .1, 100), vent: p(.3, 0, 10), strength: p(1.4, .1, 10) }, outputs: { pressure: 'отн.', damage: 'доля' },
    initialize: () => ({ pressure: 0, damage: 0 }), advance: (s, i, q, dt) => { const pressure = Math.max(0, s.pressure + dt * (Math.max(0, i.release) - q.vent * s.pressure) / q.capacity); return { pressure, damage: clamp(s.damage + dt * .08 * Math.max(0, pressure - q.strength) ** 2) }; }, observe: s => ({ ...s }) });
export const builtInModels = { supply, pump, 'feedback-source': feedback, channel, separator, turbine, 'heat-exchanger': exchanger, sensor, protection, structure };
