import { system, simulation, signal, add, div } from '@scada/plant';
export const coolingSystem = system('cooling', 'Циркуляция и теплоотвод', 'unit4');
export const electricalSystem = system('electrical', 'Электроснабжение', 'unit4');
export const grid = simulation('GRID', 'supply', {
    system: 'electrical', at: { x: 40, y: 450 }, parameters: { voltage: 1 },
});
export const pumpA = simulation('PUMP-A', 'pump', {
    system: 'cooling', at: { x: 300, y: 400 },
    inputs: { voltage: grid.voltage, resistance: signal('loopA.resistance') },
});
export const pumpB = simulation('PUMP-B', 'pump', {
    system: 'cooling', at: { x: 300, y: 860 },
    inputs: { voltage: grid.voltage, resistance: signal('loopB.resistance') },
});
export const condenser = simulation('COND', 'heat-exchanger', {
    system: 'cooling', at: { x: 1760, y: 1000 },
    inputs: { heat: signal('TURBINE.exhaust'), cooling: div(add(pumpA.flow, pumpB.flow), 2) },
});
