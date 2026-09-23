import { system, simulation, signal, add, div } from '@saturn/core';
export const steamSystem = system('steam', 'Паровой тракт и турбогенератор', 'unit4');
export const separatorA = simulation('DRUM-A', 'separator', {
    system: 'steam', at: { x: 1540, y: 520 },
    inputs: { heat: signal('loopA.heat'), demand: 1 },
});
export const separatorB = simulation('DRUM-B', 'separator', {
    system: 'steam', at: { x: 1540, y: 870 },
    inputs: { heat: signal('loopB.heat'), demand: 1 },
});
export const turbine = simulation('TURBINE', 'turbine', {
    system: 'steam', at: { x: 1540, y: 1220 },
    inputs: { steam: div(add(separatorA.steam, separatorB.steam), 2), load: 1 },
});
