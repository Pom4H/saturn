import { benchPanel } from './views';
import { system, simulation, control, plc, pin, gt, block, setpoint, functionBlock, port, cable, expansion, alarm, view } from '@scada/plant';
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
  title:'Commissioning bench',rows:[{label:'AI1 x100',pin:'AI1'},{label:'Relay DO1',pin:'DO1'}],
  view:view('plc-screen',{title:'PLC',body:benchPanel,bindings:{input:pin('AI1'),output:block('drive')}}),
  initial:'main',
  screens:[
   {id:'main',title:'SATURN-1',screenType:'main',period:100,elements:[
    {id:'head',primitive:'rect',position:{x:0,y:0},width:320,height:32,color:16904},
    {id:'title',primitive:'text',label:'SATURN-1',position:{x:10,y:8},font:1,color:65535},
    {id:'subtitle',primitive:'text',label:'Стенд управления',position:{x:10,y:48}},
    {id:'ai1',primitive:'value',label:'AI1 x100: ',position:{x:10,y:82},binding:{source:'input',ref:'AI1',format:'int'}},
    {id:'do1',primitive:'status',label:'Реле DO1: ',position:{x:10,y:118},binding:{source:'output',ref:'DO1',format:'bool'}},
    {id:'manual',primitive:'status',label:'Ручной: ',position:{x:10,y:154},binding:{source:'sp',ref:'MANUAL',format:'bool'}},
    {id:'hint',primitive:'text',label:'RIGHT I/O   DOWN LOAD',position:{x:10,y:205},color:33808},
   ]},
   {id:'io',title:'I/O',screenType:'diagnostics',period:100,elements:[
    {id:'head',primitive:'rect',position:{x:0,y:0},width:320,height:32,color:16904},
    {id:'title',primitive:'text',label:'Входы / выходы',position:{x:10,y:8},font:1,color:65535},
    {id:'ai1',primitive:'value',label:'AI1: ',position:{x:10,y:58},binding:{source:'input',ref:'AI1',format:'int'}},
    {id:'do1',primitive:'status',label:'DO1: ',position:{x:10,y:98},binding:{source:'output',ref:'DO1',format:'bool'}},
    {id:'route',primitive:'text',label:'AI1 >500 -> DO1',position:{x:10,y:148}},
    {id:'hint',primitive:'text',label:'LEFT MAIN   RIGHT LOAD',position:{x:10,y:205},color:33808},
   ]},
   {id:'load',title:'Нагрузка',screenType:'manual',period:100,elements:[
    {id:'head',primitive:'rect',position:{x:0,y:0},width:320,height:32,color:16904},
    {id:'title',primitive:'text',label:'Управляемая нагрузка',position:{x:10,y:8},font:1,color:65535},
    {id:'relay',primitive:'status',label:'RELAY-1: ',position:{x:10,y:64},binding:{source:'output',ref:'DO1',format:'bool'}},
    {id:'lamp',primitive:'status',label:'LAMP-1: ',position:{x:10,y:106},binding:{source:'output',ref:'DO1',format:'bool'}},
    {id:'manual',primitive:'status',label:'Ручной режим: ',position:{x:10,y:148},binding:{source:'sp',ref:'MANUAL',format:'bool'}},
    {id:'hint',primitive:'text',label:'UP ON  DOWN OFF  LEFT I/O',position:{x:10,y:205},color:33808},
   ]},
  ],
  keys:{
   main:{right:'io',down:'load',left:'load',up:'io'},
   io:{left:'main',right:'load',up:'main',down:'load'},
   load:{left:'io',right:'main',up:{setpoint:'MANUAL',value:1},down:{setpoint:'MANUAL',value:0}},
  },
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
