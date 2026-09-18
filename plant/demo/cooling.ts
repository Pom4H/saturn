import { system, simulation, signal, add, div } from '@scada/plant';
export const coolingSystem = system('cooling', 'Циркуляция и теплоотвод', 'unit4');
export const electricalSystem = system('electrical', 'Электроснабжение', 'unit4');
export const grid = simulation('GRID', 'supply', {
    system: 'electrical', at: { x: 60, y: 520 }, parameters: { voltage: 1 },
});
export const pumpA = simulation('PUMP-A', 'pump', {
    system: 'cooling', at: { x: 380, y: 520 },
    inputs: { voltage: grid.voltage, resistance: signal('loopA.resistance') },
});
export const pumpB = simulation('PUMP-B', 'pump', {
    system: 'cooling', at: { x: 380, y: 870 },
    inputs: { voltage: grid.voltage, resistance: signal('loopB.resistance') },
});
export const condenser = simulation('COND', 'heat-exchanger', {
    system: 'cooling', at: { x: 380, y: 1220 },
    inputs: { heat: signal('TURBINE.exhaust'), cooling: div(add(pumpA.flow, pumpB.flow), 2) },
});
