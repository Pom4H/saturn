import { system, simulation, signal, add, div } from '@scada/plant';
export const steamSystem = system('steam', 'Паровой тракт и турбогенератор', 'unit4');
export const separatorA = simulation('DRUM-A', 'separator', {
    system: 'steam', at: { x: 1440, y: 380 },
    inputs: { heat: signal('loopA.heat'), demand: 1 },
});
export const separatorB = simulation('DRUM-B', 'separator', {
    system: 'steam', at: { x: 1440, y: 860 },
    inputs: { heat: signal('loopB.heat'), demand: 1 },
});
export const turbine = simulation('TURBINE', 'turbine', {
    system: 'steam', at: { x: 1760, y: 420 },
    inputs: { steam: div(add(separatorA.steam, separatorB.steam), 2), load: 1 },
});
