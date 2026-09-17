import { system, simulation, signal } from '@scada/plant';
export const safetySystem = system('safety', 'Измерение и защитное воздействие', 'unit4');
export const buildingSystem = system('building', 'Конструкции здания', 'unit4');
export const sensor = simulation('TEMP', 'sensor', {
    system: 'safety', at: { x: 320, y: 70 },
    inputs: { value: signal('core.temperature') }, parameters: { lag: 0.2 },
});
export const protection = simulation('PROTECT', 'protection', {
    system: 'safety', at: { x: 40, y: 70 },
    inputs: { temperature: sensor.value, power: signal('CORE.power') },
    parameters: { actuation: 20 },
});
export const building = simulation('BUILDING', 'structure', {
    system: 'building', at: { x: 1420, y: 40 },
    inputs: { release: signal('core.release') },
});
