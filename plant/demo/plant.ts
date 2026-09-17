import { project, system, alarm, signal } from '@scada/plant';
import { coreSystem, groupA, groupB, reactor, channels, coreSignals } from './core';
import { coolingSystem, electricalSystem, grid, pumpA, pumpB, condenser } from './cooling';
import { steamSystem, separatorA, separatorB, turbine } from './steam';
import { safetySystem, buildingSystem, sensor, protection, building } from './safety';
import { reports } from './reports';
// Educational topology inspired by Chernobyl Unit 4. Normalized coefficients are NOT reactor settings.
// No scheduled explosion, accident label or timestamp is visible to equipment models.
export default project('chernobyl-study', {
    title: 'ЧАЭС · энергоблок 4',
    overview: [
        { signal: 'CORE.power', label: 'Тепловыделение', unit: 'отн.' },
        { signal: 'core.temperature', label: 'Температура каналов', unit: 'отн.' },
        { signal: 'core.void', label: 'Паровая доля', unit: 'доля' },
        { signal: 'core.damage', label: 'Повреждение каналов', unit: 'доля', alarmAbove: 0.05 },
        { signal: 'BUILDING.damage', label: 'Повреждение здания', unit: 'доля', alarmAbove: 0.05 },
    ],
    description: 'Учебная модель связанных процессов. Нормированные величины; не реконструкция аварии и не расчёт ядерной безопасности.',
    systems: [system('site', 'Чернобыльская АЭС'), system('unit4', 'Энергоблок 4', 'site'),
        coreSystem, groupA, groupB, coolingSystem, electricalSystem, steamSystem, safetySystem, buildingSystem],
    simulations: [grid, pumpA, pumpB, reactor, ...channels, separatorA, separatorB, turbine, condenser, sensor, protection, building],
    signals: coreSignals,
    alarms: [
        alarm('hot-channels', { title: 'Нагрев каналов', signal: signal('core.temperature'), above: 1.6, clearBelow: 1.5, delay: 1000 }),
        alarm('channel-damage', { title: 'Повреждение каналов', signal: signal('core.damage'), above: 0.05, clearBelow: 0.01, delay: 0, priority: 'critical' }),
        alarm('structure-damage', { title: 'Повреждение конструкции', signal: signal('BUILDING.damage'), above: 0.05, clearBelow: 0.01, delay: 0, priority: 'critical' }),
    ],
    reports,
    history: { deadband: 0.001, maxInterval: 10000, retention: 86400000 },
});
