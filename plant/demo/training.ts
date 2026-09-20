import { system, simulation, control, alarm, report } from '@saturn/core';
// Deliberately independent of the historical reactor schematic. No real reactor commands,
// operating limits or protective-system bypasses. Only normalized fictional heat balance.
export const trainingSystem = system('training', 'Тепловой стенд · восстановление устойчивости', 'site');
export const heatDemand = control('LAB-HEAT', { title: 'Учебная тепловая нагрузка', system: 'training', min: .25, max: 1.8, initial: .85, rate: .06, step: .05 });
export const coolingDemand = control('LAB-COOLING', { title: 'Учебный теплоотвод', system: 'training', min: .15, max: 1.2, initial: .85, rate: .07, step: .05 });
export const drive = simulation('LAB-DRIVE', 'electric-motor', { system: 'training', at: {x: 390, y: 2530}, inputs: { demand: coolingDemand.value } });
export const tower = simulation('LAB-TOWER', 'cooling-tower', { system: 'training', at: {x: 850, y: 2530}, inputs: { drive: drive.speed } });
export const store = simulation('LAB-THERMAL', 'thermal-store', { system: 'training', at: {x: 1440, y: 2530}, inputs: { load: heatDemand.value, cooling: tower.cooling } });
export const sensor = simulation('LAB-TEMP', 'sensor', { system: 'training', at: {x: 2040, y: 2530}, inputs: { value: store.temperature } });
export const trainingNodes = [drive, tower, store, sensor];
export const trainingControls = [heatDemand, coolingDemand];
export const trainingAlarms = [
    alarm('lab-hot', { title: 'Учебный стенд: растущая температура', signal: sensor.value, above: 1.55, clearBelow: 1.35, delay: 2000 }),
    alarm('lab-damage', { title: 'Учебный стенд: накопленное повреждение', signal: store.damage, above: .01, clearBelow: .001, priority: 'critical', delay: 0 }),
];
export const trainingReport = report('lab-recovery', { title: 'Учебный стенд · тепловой баланс', on: { workflow_dispatch: {} },
    window: 900000, signals: ['LAB-THERMAL.temperature', 'LAB-THERMAL.generated', 'LAB-THERMAL.removed', 'LAB-THERMAL.damage'],
    sql: "SELECT signal, MAX(value) AS maximum FROM samples WHERE quality='good' GROUP BY signal", columns: [{key:'signal',title:'Сигнал'},{key:'maximum',title:'Максимум'}] });
