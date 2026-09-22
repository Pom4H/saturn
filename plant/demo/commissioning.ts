import { benchPanel } from './views';
import { system, simulation, control, plc, pin, signal, gt, block, setpoint, functionBlock, cable, expansion, alarm, view } from '@saturn/core';
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
   view:view('plc-screen',{title:'PLC',body:benchPanel,bindings:{input:pin('AI1'),output:block('drive')}}),
   title:'Commissioning bench',
   rows:[{label:'AI1 x100',pin:'AI1'},{label:'Relay DO1',pin:'DO1'}],
   scene:{width:320,height:240,background:0x0024,nodes:[
     {id:'title',kind:'text',x:12,y:10,text:'SATURN · PUMP LOOP',color:0xffff,size:14,weight:700},
     {id:'tank',kind:'tank',x:14,y:52,width:58,height:128,level:{signal:'AI1',scale:.001,min:0,max:1},shell:0xbdf7,background:0x0841,water:0x05ff,waterLine:0x07ff},
     {id:'flow',kind:'flow',points:[{x:72,y:116},{x:120,y:116},{x:145,y:132}],value:{signal:'DO1'},background:0x2104,color:0x07ff,width:4,packetSpacing:18,speed:42},
     {id:'pump',kind:'pump',cx:188,cy:132,r:31,rpm:{signal:'DO1',scale:420},shell:0x0841,body:0x2104,bladeA:0x07ff,bladeB:0x04b2,hub:0xffff,bladeCount:6},
     {id:'lamp',kind:'lamp',cx:278,cy:60,r:15,value:{signal:'DO1'},off:0x2104,on:0x07e0,halo:0x07e0,highlight:0xffff},
     {id:'input',kind:'text',x:92,y:196,text:{value:{signal:'AI1'},prefix:'AI1 ',digits:0},color:0xffff,size:12,weight:700,mono:true},
     {id:'output',kind:'text',x:210,y:196,text:{value:{signal:'DO1'},prefix:'DO1 ',digits:0,on:'ON',off:'OFF'},color:0xffff,size:12,weight:700,mono:true}
   ]}
 }
});
export const relay=simulation('RELAY-1','contactor',{system:'commissioning',at:{x:1370,y:3100}});
export const lamp=simulation('LAMP-1','indicator',{system:'commissioning',at:{x:1780,y:3100}});
export const module=simulation('EXP-AI4','io-module',{system:'commissioning',at:{x:1150,y:3480}});
export const benchNodes=[psu,sensor,relay,lamp,module];
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
