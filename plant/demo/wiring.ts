import { pipe, cable, port } from '@scada/plant';
// Declared physical schematic routes. They do not imply a calibrated hydraulic or circuit solver.
export const plantWires=[
 pipe('aux-water-out',port('AUX-TANK','outlet'),port('AUX-VALVE','inlet')),
 pipe('service-filter',port('CW-FILTER','outlet'),port('CW-CHECK','inlet')),
 pipe('service-vessel',port('CW-CHECK','outlet'),port('CW-VESSEL','inlet')),
 pipe('lab-cooling',port('LAB-TOWER','outlet'),port('LAB-THERMAL','inlet')),
 pipe('lab-return',port('LAB-THERMAL','outlet'),port('LAB-TOWER','inlet')),
 cable('service-power',port('GEN','output'),port('TR','primary'),{medium:'power'}),
 cable('motor-power',port('TR','secondary'),port('CW-DRIVE','power'),{medium:'power'}),
 cable('ups-feeder',port('AUX-UPS','out'),port('AUX-FEEDER','in'),{medium:'power'}),
 cable('feeder-fan',port('AUX-FEEDER','out'),port('AUX-FAN','power'),{medium:'power'}),
];
// The visual connection editor appends bounded DSL declarations here, preserving other modules.
export const userWires=[];
