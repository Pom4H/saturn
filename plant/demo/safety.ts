import { system, simulation, signal } from '@saturn/core';
export const safetySystem = system('safety', 'Измерение и защитное воздействие', 'unit4');
export const buildingSystem = system('building', 'Конструкции здания', 'unit4');
export const sensor = simulation('TEMP', 'sensor', {
    system: 'safety', at: { x: 380, y: 140 },
    inputs: { value: signal('core.temperature') }, parameters: { lag: 0.2 },
});
export const protection = simulation('PROTECT', 'protection', {
    system: 'safety', at: { x: 60, y: 140 },
    inputs: { temperature: sensor.value, power: signal('CORE.power') },
    parameters: { actuation: 20 },
});
export const building = simulation('BUILDING', 'structure', {
    system: 'building', at: { x: 1540, y: 140 },
    inputs: { release: signal('core.release') },
});
