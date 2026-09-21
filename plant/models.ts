import type { ModelSpec, SignalRuntimeType } from './types';
import { failCode } from './diagnostics';
/** Models are trusted installed modules. All plant-specific wiring lives in DSL files. */
const registry = new Map<string, ModelSpec>();
export function registerModel(model: ModelSpec): void {
    if (registry.has(model.kind))
        failCode('SATURN_MODEL_INVALID',{model:model.kind,reason:'duplicate'},{kind:model.kind});
    registry.set(model.kind, model);
}
export function model(kind: string): ModelSpec { const m = registry.get(kind); if (!m)
    failCode('SATURN_NOT_FOUND',{resource:'model',id:kind},{kind}); return m; }
export const models = () => [...registry.values()];
export const outputType = (spec: Pick<ModelSpec,'outputTypes'>, key: string): SignalRuntimeType => spec.outputTypes?.[key] ?? 'number';
const p = (value: number, min = 0, max = 100) => ({ default: value, min, max });
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const approach = (x: number, to: number, dt: number, tau: number) => x + (to - x) * (1 - Math.exp(-dt / Math.max(.02, tau)));
const installed = <const M extends Omit<ModelSpec, 'version'>>(m: M): M & { version: string } => {
    const definition = { ...m, version: '1.0.0' };
    registerModel(definition);
    return definition;
};
const supply = installed({ kind: 'supply', title: 'Электропитание', visual: 'generator', inputs: {}, parameters: { voltage: p(1, 0, 1.5) }, outputs: { voltage: 'отн.' }, outputDimensions: { voltage: 'voltage' } as const,
    initialize: q => ({ voltage: q.voltage }), advance: (_s, _i, q) => ({ voltage: q.voltage }), observe: s => ({ ...s }) });
const pump = installed({ kind: 'pump', title: 'Циркуляционный насос', visual: 'pump', inputs: { voltage: 1, resistance: 1 }, inputDimensions: { voltage: 'voltage', resistance: 'resistance' } as const, parameters: { inertia: p(6, .1, 120), nominalFlow: p(1, .01, 100) }, outputs: { flow: 'отн.', rpm: 'об/мин', power: 'отн.' }, outputDimensions: { flow: 'flow', rpm: 'rotational-speed', power: 'power' } as const,
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
const exchanger = installed({ kind: 'heat-exchanger', title: 'Конденсатор', visual: 'exchanger', inputs: { heat: .1, cooling: 1 }, inputDimensions: { heat: 'power', cooling: 'flow' } as const, parameters: { capacity: p(12, .1, 100), ambient: p(.2, 0, 1) }, outputs: { temperature: 'отн.', rejected: 'отн.' }, outputDimensions: { temperature: 'temperature', rejected: 'power' } as const,
    initialize: q => ({ temperature: q.ambient, rejected: 0 }), advance: (s, i, q, dt) => { const rejected = Math.max(0, i.cooling) * (s.temperature - q.ambient); return { temperature: Math.max(q.ambient, s.temperature + dt * (i.heat - rejected) / q.capacity), rejected }; }, observe: s => ({ ...s }) });
const sensor = installed({ kind: 'sensor', title: 'Измерительный канал', visual: 'sensor', inputs: { value: 0 }, parameters: { lag: p(.2, .02, 30), bias: p(0, -100, 100) }, outputs: { value: 'отн.' }, initialize: () => ({ value: 0 }), advance: (s, i, q, dt) => ({ value: approach(s.value, i.value + q.bias, dt, q.lag) }), observe: s => ({ ...s }) });
const protection = installed({ kind: 'protection', title: 'Защита и поглотитель', visual: 'control', inputs: { temperature: 1, power: 1, demand: 0 }, parameters: { temperatureLimit: p(1.7, 1, 5), powerLimit: p(2, 1, 10), actuation: p(1, .05, 60) }, outputs: { insertion: 'доля', trip: 'лог.' }, outputTypes: { trip: 'boolean' } as const,
    initialize: () => ({ insertion: 0, trip: 0 }), advance: (s, i, q, dt) => { const trip = s.trip || i.temperature > q.temperatureLimit || i.power > q.powerLimit || i.demand > .5 ? 1 : 0; return { trip, insertion: approach(s.insertion, trip, dt, q.actuation) }; }, observe: s => ({ ...s }) });
const structure = installed({ kind: 'structure', title: 'Реакторное здание', visual: 'structure', inputs: { release: 0 }, parameters: { capacity: p(12, .1, 100), vent: p(.3, 0, 10), strength: p(1.4, .1, 10) }, outputs: { pressure: 'отн.', damage: 'доля' },
    initialize: () => ({ pressure: 0, damage: 0 }), advance: (s, i, q, dt) => { const pressure = Math.max(0, s.pressure + dt * (Math.max(0, i.release) - q.vent * s.pressure) / q.capacity); return { pressure, damage: clamp(s.damage + dt * .08 * Math.max(0, pressure - q.strength) ** 2) }; }, observe: s => ({ ...s }) });
/** Generic balance-of-plant teaching components. Coefficients are dimensionless,
 * not equipment datasheets, nuclear operating limits, or a site reconstruction. */
const reservoir = installed({ kind: 'reservoir', title: 'Буферная ёмкость', visual: 'reservoir', inputs: { inflow: .1, demand: .1 }, inputDimensions: { inflow: 'flow', demand: 'flow' } as const,
    parameters: { capacity: p(10, 1, 1000), initialLevel: p(.7, 0, 1) },
    outputs: { level: '%', inventory: 'отн.', flow: 'отн.', spill: 'отн.', balance: 'отн.' }, outputDimensions: { level: 'ratio', inventory: 'volume', flow: 'flow', spill: 'flow', balance: 'volume' } as const,
    initialize: q => ({ inventory: q.capacity * q.initialLevel, flow: 0, spill: 0, balance: 0 }),
    advance: (s, i, q, dt) => {
        const incoming = Math.max(0, i.inflow), available = s.inventory + incoming * dt;
        const flow = Math.min(Math.max(0, i.demand), available / dt);
        const spill = Math.max(0, (available - flow * dt - q.capacity) / dt);
        const inventory = clamp(available - (flow + spill) * dt, 0, q.capacity);
        return { inventory, flow, spill, balance: inventory - s.inventory - dt * (incoming - flow - spill) };
    }, observe: (s, q) => ({ ...s, level: 100 * s.inventory / q.capacity }) });
const valve = installed({ kind: 'motor-valve', title: 'Регулирующий клапан', visual: 'valve', inputs: { demand: .5, pressure: 1 }, inputDimensions: { demand: 'ratio', pressure: 'ratio' } as const,
    parameters: { travel: p(2, .1, 60), capacity: p(.3, .01, 10) }, outputs: { opening: '%', flow: 'отн.' }, outputDimensions: { opening: 'ratio', flow: 'flow' } as const,
    initialize: () => ({ opening: .5, flow: .15 }),
    advance: (s, i, q, dt) => { const opening = approach(s.opening, clamp(i.demand), dt, q.travel); return { opening, flow: q.capacity * opening * Math.sqrt(Math.max(0, i.pressure)) }; },
    observe: s => ({ opening: s.opening * 100, flow: s.flow }) });
const ups = installed({ kind: 'ups', title: 'Резервное питание', visual: 'battery', inputs: { grid: 1, demand: .1 },
    parameters: { capacity: p(30, 1, 1000), charging: p(.1, .01, 10) }, outputs: { voltage: 'отн.', charge: '%', load: 'отн.' },
    initialize: q => ({ energy: q.capacity, voltage: 1, load: 0 }),
    advance: (s, i, q, dt) => { const grid = i.grid >= .8, load = Math.max(0, i.demand); const energy = clamp(s.energy + dt * (grid ? q.charging : -load), 0, q.capacity); return { energy, voltage: grid || energy > 0 ? 1 : 0, load }; },
    observe: (s, q) => ({ voltage: s.voltage, charge: 100 * s.energy / q.capacity, load: s.load }) });
const switchgear = installed({ kind: 'switchgear', title: 'Щит питания', visual: 'switchgear', inputs: { voltage: 1, demand: 1, load: .1 },
    parameters: { limit: p(1.5, .1, 10) }, outputs: { voltage: 'отн.', closed: 'лог.', trip: 'лог.' }, outputTypes: { closed: 'boolean', trip: 'boolean' } as const,
    initialize: () => ({ voltage: 1, closed: 1, trip: 0 }),
    advance: (s, i, q) => { const trip = s.trip || i.load > q.limit ? 1 : 0, closed = i.demand > .5 && !trip ? 1 : 0; return { voltage: Math.max(0, i.voltage) * closed, closed, trip }; }, observe: s => ({ ...s }) });
const fan = installed({ kind: 'fan', title: 'Вентиляция и теплоотвод', visual: 'fan', inputs: { voltage: 1, demand: .8 }, inputDimensions: { voltage: 'voltage', demand: 'ratio' } as const,
    parameters: { inertia: p(3, .1, 120) }, outputs: { airflow: 'отн.', rpm: 'об/мин', load: 'отн.' }, outputDimensions: { airflow: 'flow', rpm: 'rotational-speed', load: 'power' } as const,
    initialize: () => ({ speed: .8 }), advance: (s, i, q, dt) => ({ speed: approach(s.speed, clamp(i.voltage) * clamp(i.demand), dt, q.inertia) }),
    observe: s => ({ airflow: s.speed, rpm: 1200 * s.speed, load: .3 * s.speed ** 3 }) });


/** Balance-of-plant primitives in normalized teaching units. Never site operating data. */
const motor = installed({ kind: 'electric-motor', title: 'Электропривод', visual: 'motor',
    inputs: { voltage: 1, demand: .85 }, inputDimensions: { voltage: 'voltage', demand: 'ratio' } as const, parameters: { inertia: p(5, .1, 60) },
    outputs: { speed: 'отн.', rpm: 'об/мин', load: 'отн.' }, outputDimensions: { speed: 'ratio', rpm: 'rotational-speed', load: 'power' } as const,
    initialize: () => ({ speed: .85 }),
    advance: (s, i, q, dt) => ({ speed: approach(s.speed, clamp(i.voltage) * clamp(i.demand, 0, 1.2), dt, q.inertia) }),
    observe: s => ({ speed: s.speed, rpm: s.speed * 1500, load: .25 * s.speed ** 3 }) });
const tower = installed({ kind: 'cooling-tower', title: 'Охладитель оборотной воды', visual: 'tower',
    inputs: { drive: .85, temperature: 1, flow: 1 }, parameters: { inertia: p(6, .1, 120), ambient: p(.2, 0, 1) },
    outputs: { cooling: 'отн.', rejected: 'отн.', rpm: 'об/мин' },
    initialize: () => ({ cooling: .85, rejected: 0 }),
    advance: (s, i, q, dt) => { const cooling = approach(s.cooling, clamp(i.drive, 0, 1.2) * clamp(i.flow), dt, q.inertia);
        return { cooling, rejected: cooling * Math.max(0, i.temperature - q.ambient) }; },
    observe: s => ({ ...s, rpm: s.cooling * 900 }) });
const filter = installed({ kind: 'strainer', title: 'Сетчатый фильтр', visual: 'filter',
    inputs: { flow: .2, impurity: .02, flush: .02 }, parameters: { accumulation: p(.03, 0, 1) },
    outputs: { resistance: 'отн.', fouling: '%', pressureDrop: 'отн.' },
    initialize: () => ({ dirt: .1, pressureDrop: .02 }),
    advance: (s, i, q, dt) => { const dirt = clamp(s.dirt + dt * q.accumulation * (Math.max(0, i.impurity) * Math.abs(i.flow) - Math.max(0, i.flush) * s.dirt));
        return { dirt, pressureDrop: (1 + 5 * dirt) * i.flow ** 2 }; },
    observe: s => ({ resistance: 1 + 5 * s.dirt, fouling: s.dirt * 100, pressureDrop: s.pressureDrop }) });
const checkValve = installed({ kind: 'check-valve', title: 'Обратный клапан', visual: 'checkvalve',
    inputs: { upstream: 1, downstream: .3 }, parameters: { capacity: p(.2, .01, 10), cracking: p(.02, 0, 2) },
    outputs: { flow: 'отн.', opening: '%' }, initialize: () => ({ flow: 0, opening: 0 }),
    advance: (_s, i, q) => { const head = Math.max(0, i.upstream - i.downstream - q.cracking);
        return { flow: q.capacity * Math.sqrt(head), opening: head > 0 ? 100 : 0 }; }, observe: s => ({ ...s }) });
const vessel = installed({ kind: 'expansion-vessel', title: 'Расширительный бак', visual: 'accumulator',
    inputs: { inflow: .05, outflow: .05 }, parameters: { capacity: p(10, 1, 100), stiffness: p(1, .1, 5) },
    outputs: { pressure: 'отн.', level: '%', outflow: 'отн.', spill: 'отн.', balance: 'отн.' },
    initialize: q => ({ inventory: q.capacity * .5, outflow: 0, spill: 0, balance: 0 }),
    advance: (s, i, q, dt) => { const incoming = Math.max(0, i.inflow), available = s.inventory + incoming * dt;
        const outflow = Math.min(Math.max(0, i.outflow), available / dt), spill = Math.max(0, (available - outflow * dt - q.capacity) / dt);
        const inventory = clamp(available - dt * (outflow + spill), 0, q.capacity);
        return { inventory, outflow, spill, balance: inventory - s.inventory - dt * (incoming - outflow - spill) }; },
    observe: (s, q) => ({ pressure: q.stiffness * s.inventory / q.capacity, level: s.inventory / q.capacity * 100, outflow: s.outflow, spill: s.spill, balance: s.balance }) });
const relief = installed({ kind: 'relief-valve', title: 'Предохранительный клапан', visual: 'relief',
    inputs: { pressure: .5, downstream: 0 }, parameters: { setpoint: p(.7, .1, 5), capacity: p(.4, .01, 10), travel: p(.4, .05, 10) },
    outputs: { flow: 'отн.', opening: '%' }, initialize: () => ({ opening: 0, flow: 0 }),
    advance: (s, i, q, dt) => { const opening = approach(s.opening, clamp((i.pressure - q.setpoint) * 5), dt, q.travel);
        return { opening, flow: opening * q.capacity * Math.sqrt(Math.max(0, i.pressure - i.downstream)) }; },
    observe: s => ({ flow: s.flow, opening: s.opening * 100 }) });
const transformer = installed({ kind: 'transformer', title: 'Трансформатор', visual: 'transformer',
    inputs: { voltage: 1, load: .2 }, inputDimensions: { voltage: 'voltage', load: 'power' } as const, parameters: { efficiency: p(.96, .5, 1), thermalTime: p(20, 1, 100) },
    outputs: { voltage: 'отн.', temperature: 'отн.', loss: 'отн.' }, outputDimensions: { voltage: 'voltage', temperature: 'temperature', loss: 'power' } as const,
    initialize: () => ({ voltage: 1, temperature: .2, loss: 0 }),
    advance: (s, i, q, dt) => { const loss = Math.max(0, i.load) * (1 - q.efficiency);
        return { voltage: clamp(i.voltage, 0, 1.5), loss, temperature: approach(s.temperature, .2 + loss * 2, dt, q.thermalTime) }; }, observe: s => ({ ...s }) });
const alternator = installed({ kind: 'alternator', title: 'Турбогенератор', visual: 'alternator',
    inputs: { rpm: 1500, load: .5 }, parameters: { efficiency: p(.94, .5, 1) },
    outputs: { voltage: 'отн.', electricity: 'отн.', rpm: 'об/мин' }, initialize: () => ({ voltage: 1, electricity: .47, rpm: 1500 }),
    advance: (_s, i, q) => ({ voltage: clamp(i.rpm / 1500, 0, 1.2), electricity: Math.max(0, i.rpm / 1500 * i.load * q.efficiency), rpm: Math.max(0, i.rpm) }), observe: s => ({ ...s }) });
/** Fictional self-heating calorimeter for recovery exercises, unrelated to neutron physics.
 * Energy balance and irreversible accumulated damage; no event clock or scenario name. */
const thermalStore = installed({ kind: 'thermal-store', title: 'Тепловой учебный агрегат', visual: 'calorimeter',
    inputs: { load: .85, cooling: .85 },
    parameters: { capacity: p(75, 10, 150), feedback: p(.75, 0, 2), ambient: p(.2, 0, .5), initialTemperature: p(1.15, .2, 2) },
    outputs: { temperature: 'отн.', energy: 'отн.', generated: 'отн.', removed: 'отн.', trend: 'отн./с', damage: 'доля', balance: 'отн.' },
    initialize: q => ({ temperature: q.initialTemperature, energy: q.capacity * q.initialTemperature, generated: .85, removed: .85, trend: 0, damage: 0, balance: 0 }),
    advance: (s, i, q, dt) => {
        const generated = Math.max(0, i.load) + q.feedback * Math.min(8, Math.max(0, s.temperature - 1.2) ** 2);
        const requestedRemoval = (.18 + .85 * Math.max(0, i.cooling)) * Math.max(0, s.temperature - q.ambient) * (1 - .25 * s.damage);
        const removed = Math.min(requestedRemoval, s.energy / dt + generated), energy = s.energy + dt * (generated - removed);
        const temperature = energy / q.capacity, trend = (temperature - s.temperature) / dt;
        const damage = clamp(s.damage + dt * .015 * Math.max(0, temperature - 2.8) ** 2);
        return { temperature, energy, generated, removed, trend, damage, balance: energy - s.energy - dt * (generated - removed) };
    }, observe: s => ({ ...s }) });


// Low-energy fictional commissioning bench. It has no connection to nuclear controls.
const dcSupply=installed({kind:'dc-supply',visual:'dcSupply',title:'Источник 24 V DC · стенд',inputs:{enable:1},inputDimensions:{enable:'ratio'} as const,parameters:{voltage:p(24,12,24)},outputs:{voltage:'V',return:'V'},outputDimensions:{voltage:'voltage',return:'voltage'} as const,initialize:()=>({voltage:0,return:0}),advance:(_s,i,q)=>({voltage:i.enable>0?q.voltage:0,return:0}),observe:s=>({...s})});
const transmitter=installed({kind:'transmitter',visual:'transmitter',title:'Измерительный преобразователь',inputs:{value:0},parameters:{gain:p(1,0,1000)},outputs:{value:'отн.'},initialize:()=>({value:0}),advance:(_s,i,q)=>({value:i.value*q.gain}),observe:s=>({...s})});
const contactor=installed({kind:'contactor',visual:'contactor',title:'Промежуточное реле · стенд',inputs:{coil:0,supply:0},parameters:{travel:p(.1,.02,1)},outputs:{voltage:'V',closed:'доля'},initialize:()=>({voltage:0,closed:0}),advance:(s,i,q,dt)=>{const closed=approach(s.closed,i.coil>0?1:0,dt,q.travel);return{closed,voltage:closed>.8?i.supply:0};},observe:s=>({...s})});
const indicator=installed({kind:'indicator',visual:'indicator',title:'Сигнальная лампа · стенд',inputs:{voltage:0},parameters:{nominal:p(24,12,24)},outputs:{brightness:'доля'},initialize:()=>({brightness:0}),advance:(_s,i,q)=>({brightness:clamp(i.voltage/q.nominal)}),observe:s=>({...s})});
const ioModule=installed({kind:'io-module',visual:'ioModule',title:'Виртуальный модуль AI4 · не аппаратный профиль',inputs:{channel1:0,channel2:0,channel3:0,channel4:0},parameters:{},outputs:{channel1:'отн.',channel2:'отн.',channel3:'отн.',channel4:'отн.'},initialize:()=>({channel1:0,channel2:0,channel3:0,channel4:0}),advance:(_s,i)=>({...i}),observe:s=>({...s})});
const junction=installed({kind:'junction',visual:'junction',title:'Тройник · схема',inputs:{flow:0},parameters:{},outputs:{flow:'отн.'},initialize:()=>({flow:0}),advance:(_s,i)=>({flow:i.flow}),observe:s=>({...s})});
export const builtInModels = { 'dc-supply':dcSupply,transmitter,contactor,indicator,'io-module':ioModule,junction, supply, pump, 'feedback-source': feedback, channel, separator, turbine, 'heat-exchanger': exchanger, sensor, protection, structure, reservoir, 'motor-valve': valve, ups, switchgear, fan, 'electric-motor': motor, 'cooling-tower': tower, strainer: filter, 'check-valve': checkValve, 'expansion-vessel': vessel, 'relief-valve': relief, transformer, alternator, 'thermal-store': thermalStore };
