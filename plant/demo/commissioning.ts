import { benchPanel } from './views';
import { system, simulation, control, plc, pin, signal, gt, block, functionBlock, setpoint, cable, expansion, alarm, view } from '@saturn/core';
// Generic isolated low-voltage commissioning bench; never connected to reactor controls.
export const benchSystem=system('commissioning','PLC · стенд подключения клемм','site');
export const level=control('BENCH-LEVEL',{title:'Датчик уровня · тестовый сигнал',system:'commissioning',min:0,max:10,initial:3,rate:1,unit:'V'});
export const psu=simulation('PSU-24','dc-supply',{system:'commissioning',at:{x:80,y:3100}});
export const sensor=simulation('LEVEL-TX','transmitter',{system:'commissioning',at:{x:480,y:3480},inputs:{value:level.value}});
export const controller=plc('SATURN-1',{
 system:'commissioning',at:{x:760,y:3100},
 setpoints:{MANUAL:{caption:'Ручной выход',min:0,max:1,initial:0,step:1}},
 blocks:{drive:functionBlock('OR',[gt(pin('AI1'),500),setpoint('MANUAL')])},
 outputs:{DO1:block('drive')},
 hmi:{
  shell:{auto:true},
  title:'Commissioning bench',
  rows:[{label:'AI1 x100',pin:'AI1'},{label:'Relay DO1',pin:'DO1'}],
  // Canonical authored UI remains Presentation. The physical shell is a target projection.
  view:view('plc-screen',{title:'PLC',body:benchPanel,bindings:{input:pin('AI1'),output:block('drive')}}),
 }
});
export const processPump=simulation('PUMP-1','pump',{system:'commissioning',at:{x:1760,y:3800},inputs:{voltage:controller.DO1,resistance:1},parameters:{inertia:1.2,nominalFlow:1}});
export const processTank=simulation('TANK-1','reservoir',{system:'commissioning',at:{x:1450,y:3800},inputs:{inflow:.55,demand:processPump.flow},parameters:{capacity:20,initialLevel:.72}});
export const relay=simulation('RELAY-1','contactor',{system:'commissioning',at:{x:1370,y:3100}});
export const lamp=simulation('LAMP-1','indicator',{system:'commissioning',at:{x:1780,y:3100}});
export const module=simulation('EXP-AI4','io-module',{system:'commissioning',at:{x:1150,y:3480}});
export const benchNodes=[psu,sensor,processTank,processPump,relay,lamp,module];
export const benchControllers=[controller];
export const benchControls=[level];
export const benchModules=[expansion(module,controller,1)];
export const benchWires=[
 cable('dc-positive',psu.ports.plus,controller.ports['DC+'],{medium:'power'}),
 cable('dc-return',psu.ports.minus,controller.ports['DC-'],{medium:'power'}),
 cable('input-common',psu.ports.minus,controller.ports.COM1,{medium:'power'}),
 cable('sensor-common',psu.ports.minus,sensor.ports.common,{medium:'power'}),
 cable('level-input',sensor.ports.value,controller.ports.AI1,{medium:'control',scale:100}),
 cable('relay-coil',controller.ports.DO1,relay.ports.coil,{medium:'control'}),
 cable('relay-line',psu.ports.plus,relay.ports.line,{medium:'power'}),
 cable('relay-common',psu.ports.minus,relay.ports.common,{medium:'power'}),
 cable('lamp-power',relay.ports.out,lamp.ports.input,{medium:'power'}),
 cable('lamp-common',psu.ports.minus,lamp.ports.common,{medium:'power'}),
 cable('module-a',controller.ports['RS-A'],module.ports.busA,{medium:'bus'}),
 cable('module-b',controller.ports['RS-B'],module.ports.busB,{medium:'bus'}),
 cable('module-positive',psu.ports.plus,module.ports.plus,{medium:'power'}),
 cable('module-return',psu.ports.minus,module.ports.minus,{medium:'power'}),
];
export const benchAlarm=alarm('plc-unhealthy',{title:'Стенд: PLC не готов · питание или входы',signal:gt(1, signal('SATURN-1.healthy')),above:.5,clearBelow:.1,delay:2000});
