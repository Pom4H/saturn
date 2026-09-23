import { pipe, cable } from '@saturn/core';
import { tank as auxTank, valve as auxValve, backup, feeder, ventilation } from './auxiliary';
import { filter, valve as checkValve, vessel, generator, transformer, drive } from './services';
import { tower as labTower, store as labStore } from './training';

// Declared physical schematic routes. They do not imply a calibrated hydraulic or circuit solver.
export const plantWires=[
 pipe('aux-water-out',auxTank.ports.outlet,auxValve.ports.inlet),
 pipe('service-filter',filter.ports.outlet,checkValve.ports.inlet),
 pipe('service-vessel',checkValve.ports.outlet,vessel.ports.inlet),
 pipe('lab-cooling',labTower.ports.outlet,labStore.ports.inlet),
 pipe('lab-return',labStore.ports.outlet,labTower.ports.inlet),
 cable('service-power',generator.ports.output,transformer.ports.primary,{medium:'power'}),
 cable('motor-power',transformer.ports.secondary,drive.ports.power,{medium:'power'}),
 cable('ups-feeder',backup.ports.out,feeder.ports.in,{medium:'power'}),
 cable('feeder-fan',feeder.ports.out,ventilation.ports.power,{medium:'power'}),
];

// Visual connection edits append dynamic declarations here; normal authored code uses typed refs above.
export const userWires=[];
