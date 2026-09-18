import { control, signal, simulation, system, add, mul, div, gt, alarm } from '@scada/plant';
// A separate normalized service loop; this is not a real plant's equipment layout.
export const auxiliarySystem = system('auxiliary', 'Вспомогательные системы', 'unit4');
export const waterSystem = system('aux-water', 'Запас воды и регулирование', 'auxiliary');
export const airSystem = system('aux-air', 'Вентиляция и резервное питание', 'auxiliary');
export const makeup = control('MAKEUP', { title: 'Подпитка буферной ёмкости', system: 'aux-water', min: 0, max: .3, initial: .08, rate: .02, unit: 'отн./с' });
export const draw = control('DRAW', { title: 'Потребление воды · учебная нагрузка', system: 'aux-water', min: 0, max: 1, initial: .5, rate: .1,
    enableWhen: gt(signal('AUX-TANK.level'), 10), safeValue: 0, blockedReason: 'Низкий запас воды: потребление заблокировано. Сначала восстановите подпитку.' });
export const airDemand = control('AIR', { title: 'Производительность вентиляции', system: 'aux-air', min: .2, max: 1, initial: .8, rate: .1 });
export const heatLoad = control('AUX-LOAD', { title: 'Тепловая нагрузка вспомогательного контура', system: 'aux-air', min: .05, max: .6, initial: .1, rate: .03 });
export const tank = simulation('AUX-TANK', 'reservoir', { system: 'aux-water', at: { x: 1990, y: 250 },
    inputs: { inflow: makeup.value, demand: signal('AUX-VALVE.flow') } });
export const valve = simulation('AUX-VALVE', 'motor-valve', { system: 'aux-water', at: { x: 2290, y: 250 },
    inputs: { demand: draw.value, pressure: div(tank.level, 100) } });
export const backup = simulation('AUX-UPS', 'ups', { system: 'aux-air', at: { x: 1990, y: 820 },
    inputs: { grid: signal('GRID.voltage'), demand: signal('AUX-FAN.load') } });
export const feeder = simulation('AUX-FEEDER', 'switchgear', { system: 'aux-air', at: { x: 2290, y: 820 },
    inputs: { voltage: backup.voltage, load: signal('AUX-FAN.load') } });
export const ventilation = simulation('AUX-FAN', 'fan', { system: 'aux-air', at: { x: 2590, y: 820 },
    inputs: { voltage: feeder.voltage, demand: airDemand.value } });
export const airCooler = simulation('AUX-COOLER', 'heat-exchanger', { system: 'aux-air', at: { x: 2290, y: 1170 },
    inputs: { heat: heatLoad.value, cooling: add(ventilation.airflow, mul(tank.flow, .2)) } });
export const auxiliary = [tank, valve, backup, feeder, ventilation, airCooler];
export const controls = [makeup, draw, airDemand, heatLoad];
export const auxiliaryAlarms = [
    alarm('aux-water-low', { title: 'Недостаточный запас воды', signal: signal('DRAW.blocked'), above: .5, clearBelow: .1, delay: 0 }),
    alarm('aux-cooling', { title: 'Вспомогательный контур: недостаточный теплоотвод', signal: airCooler.temperature, above: .8, clearBelow: .65, delay: 2000 }),
    alarm('aux-feeder', { title: 'Щит: защитное отключение', signal: feeder.trip, above: .5, clearBelow: .1, delay: 0 }),
];
