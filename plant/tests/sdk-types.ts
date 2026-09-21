import { simulation, bank, aggregate, control, gt, signal } from '../dsl';
import type { SignalId, SignalUnitOf, SignalValueOf } from '../types';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
const pump = simulation('P', 'pump', { system: 'cooling', at: { x: 0, y: 0 }, inputs: { voltage: 1 }, parameters: { inertia: 2 } });
const flow = pump.flow;
type _FlowId = Assert<Equal<SignalId<typeof flow>, 'P.flow'>>;
type _FlowValue = Assert<Equal<SignalValueOf<typeof flow>, number>>;
type _FlowUnit = Assert<Equal<SignalUnitOf<typeof flow>, 'отн.'>>;
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

const valveDemand = control('DEMAND', {
    title: 'Water demand', system: 'services', min: 0, max: 1,
    initial: .5, rate: .1, enableWhen: gt(signal('TANK.level'), 10),
    safeValue: 0, blockedReason: 'Low inventory',
});
simulation('V', 'motor-valve', { system: 'services', at: { x: 0, y: 0 }, inputs: { demand: valveDemand.value } });
// @ts-expect-error Controls publish value/requested/blocked, not equipment outputs.
valveDemand.rpm;
// @ts-expect-error Interlocks use expressions, never source-code strings.
control('BAD', { title:'Bad', system:'services', min:0, max:1, initial:0, rate:1, enableWhen:'TANK.level > 10' });

const lab = simulation('L', 'thermal-store', {system:'lab', at:{x:0,y:0}, inputs:{load:valveDemand.value}, parameters:{capacity:75}});
const heatBalance = lab.balance;
// @ts-expect-error The fictional calorimeter has no nuclear-physics outputs.
lab.reactivity;
// @ts-expect-error Invalid drive input must not typecheck.
simulation('DRIVE', 'electric-motor', {system:'lab', at:{x:0,y:0}, inputs:{frequency:50}});


type _BlockedId = Assert<Equal<SignalId<typeof valveDemand.blocked>, 'DEMAND.blocked'>>;
type _BlockedValue = Assert<Equal<SignalValueOf<typeof valveDemand.blocked>, boolean>>;
type _BlockedUnit = Assert<Equal<SignalUnitOf<typeof valveDemand.blocked>, 'лог.'>>;
