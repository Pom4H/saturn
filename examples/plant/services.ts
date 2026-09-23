import { system, simulation, signal, add } from '@saturn/core';
// Generic supporting infrastructure, not the inventory or surveyed layout of a real NPP.
export const servicesSystem = system('services', 'Общестанционные узлы · учебная схема', 'unit4');
export const powerSystem = system('services-power', 'Преобразование и распределение энергии', 'services');
export const waterTreatment = system('services-water', 'Подготовка и оборотная вода', 'services');
export const generator = simulation('GEN', 'alternator', { system: 'services-power', at: {x: 50, y: 1850}, inputs: { rpm: signal('TURBINE.rpm'), load: .5 } });
export const transformer = simulation('TR', 'transformer', { system: 'services-power', at: {x: 340, y: 1850}, inputs: { voltage: generator.voltage, load: signal('CW-DRIVE.load') } });
export const drive = simulation('CW-DRIVE', 'electric-motor', { system: 'services-power', at: {x: 630, y: 1850}, inputs: { voltage: transformer.voltage, demand: .85 } });
export const filter = simulation('CW-FILTER', 'strainer', { system: 'services-water', at: {x: 1100, y: 1850}, inputs: { flow: signal('CW-CHECK.flow'), impurity: .02 } });
export const valve = simulation('CW-CHECK', 'check-valve', { system: 'services-water', at: {x: 1400, y: 1850}, inputs: { upstream: 1, downstream: signal('CW-VESSEL.pressure') } });
export const vessel = simulation('CW-VESSEL', 'expansion-vessel', { system: 'services-water', at: {x: 1700, y: 1850}, inputs: { inflow: valve.flow, outflow: add(signal('CW-RELIEF.flow'), .06) } });
export const relief = simulation('CW-RELIEF', 'relief-valve', { system: 'services-water', at: {x: 2000, y: 1850}, inputs: { pressure: vessel.pressure } });
export const tower = simulation('CW-TOWER', 'cooling-tower', { system: 'services-water', at: {x: 2420, y: 1850}, inputs: { drive: drive.speed, temperature: signal('COND.temperature'), flow: 1 } });
export const services = [generator, transformer, drive, filter, valve, vessel, relief, tower];
