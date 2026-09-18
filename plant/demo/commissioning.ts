import { system, simulation, control, plc, pin, gt, port, cable, expansion, alarm } from '@scada/plant';
// Generic isolated low-voltage commissioning bench; never connected to reactor controls.
export const benchSystem=system('commissioning','PLC · стенд подключения клемм','site');
export const level=control('BENCH-LEVEL',{title:'Датчик уровня · тестовый сигнал',system:'commissioning',min:0,max:10,initial:3,rate:1,unit:'V'});
export const psu=simulation('PSU-24','dc-supply',{system:'commissioning',at:{x:80,y:3100}});
export const sensor=simulation('LEVEL-TX','transmitter',{system:'commissioning',at:{x:480,y:3480},inputs:{value:level.value}});
export const controller=plc('SATURN-1',{system:'commissioning',at:{x:760,y:3100},outputs:{DO1:gt(pin('AI1'),500)},hmi:{title:'Commissioning bench',rows:[{label:'AI1 x100',pin:'AI1'},{label:'Relay DO1',pin:'DO1'}]}});
export const relay=simulation('RELAY-1','contactor',{system:'commissioning',at:{x:1370,y:3100}});
export const lamp=simulation('LAMP-1','indicator',{system:'commissioning',at:{x:1780,y:3100}});
export const module=simulation('EXP-AI4','io-module',{system:'commissioning',at:{x:1150,y:3480}});
export const benchNodes=[psu,sensor,relay,lamp,module];
export const benchControllers=[controller];
export const benchControls=[level];
export const benchModules=[expansion(module,controller,1)];
export const benchWires=[
 cable('dc-positive',port(psu,'plus'),port(controller,'DC+'),{medium:'power'}),
 cable('dc-return',port(psu,'minus'),port(controller,'DC-'),{medium:'power'}),
 cable('input-common',port(psu,'minus'),port(controller,'COM1'),{medium:'power'}),
 cable('sensor-common',port(psu,'minus'),port(sensor,'common'),{medium:'power'}),
 cable('level-input',port(sensor,'value'),port(controller,'AI1'),{medium:'control',scale:100}),
 cable('relay-coil',port(controller,'DO1'),port(relay,'coil'),{medium:'control'}),
 cable('relay-line',port(psu,'plus'),port(relay,'line'),{medium:'power'}),
 cable('relay-common',port(psu,'minus'),port(relay,'common'),{medium:'power'}),
 cable('lamp-power',port(relay,'out'),port(lamp,'input'),{medium:'power'}),
 cable('lamp-common',port(psu,'minus'),port(lamp,'common'),{medium:'power'}),
 cable('module-a',port(controller,'RS-A'),port(module,'busA'),{medium:'bus'}),
 cable('module-b',port(controller,'RS-B'),port(module,'busB'),{medium:'bus'}),
 cable('module-positive',port(psu,'plus'),port(module,'plus'),{medium:'power'}),
 cable('module-return',port(psu,'minus'),port(module,'minus'),{medium:'power'}),
];
export const benchAlarm=alarm('plc-unhealthy',{title:'Стенд: PLC не готов · питание или входы',signal:gt(1, {ref:'SATURN-1.healthy'}),above:.5,clearBelow:.1,delay:2000});
