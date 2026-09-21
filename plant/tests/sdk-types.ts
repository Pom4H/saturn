import { simulation, bank, aggregate, control, gt, signal, report, reportField, numberField, reportSchema, reportColumn, excelColumn, excelSheet, workbook, asc } from '../dsl';
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


const typedRows = reportSchema({
    time: numberField('ms'),
    flow: reportField(pump.flow),
    blocked: reportField(valveDemand.blocked),
});
const typedReport = report('typed-report', {
    title: 'Typed report',
    on: { workflow_dispatch: {} },
    signals: [pump.flow, valveDemand.blocked],
    window: 60_000,
    sql: 'SELECT 0 AS time, 1 AS flow, 0 AS blocked',
    schema: typedRows,
    columns: [
        reportColumn('Time', typedRows.time),
        reportColumn('Flow', typedRows.flow),
        reportColumn('Blocked', typedRows.blocked),
    ],
    excel: workbook([
        excelSheet('Signals', typedRows, {
            columns: [
                excelColumn('Time', typedRows.time, { format: '0' }),
                excelColumn('Flow', typedRows.flow, { format: '0.00' }),
                excelColumn('Blocked', typedRows.blocked),
            ],
            sort: [asc(typedRows.time)],
            freezeRows: 1,
            autoFilter: true,
        }),
    ]),
});
void typedReport;
// @ts-expect-error Reports consume typed signal refs, not unchecked string IDs.
report('bad-signals', { title:'Bad', on:{workflow_dispatch:{}}, signals:['P.flow'], window:1000, sql:'SELECT 1 AS x', columns:[{key:'x',title:'x'}] });
// @ts-expect-error Boolean fields do not accept numeric Excel formats.
excelColumn('Blocked', typedRows.blocked, { format: '0.00' });

const guard = simulation('GUARD', 'protection', {
    system: 'lab',
    at: { x: 0, y: 0 },
    inputs: { temperature: 1, power: 1, demand: 0 },
});
type _TripId = Assert<Equal<SignalId<typeof guard.trip>, 'GUARD.trip'>>;
type _TripValue = Assert<Equal<SignalValueOf<typeof guard.trip>, boolean>>;
type _TripUnit = Assert<Equal<SignalUnitOf<typeof guard.trip>, 'лог.'>>;
