import {
  project, system, simulation, plc, pin, gt, block, setpoint, functionBlock,
  port, cable, pipe, expansion, alarm
} from '@scada/plant';

/**
 * Standalone 320×240 HMI showcase.
 *
 * Fictional booster skid in normalized engineering units. It exists to exercise
 * the Saturn controller, Firmverse display emulator and four-key shell, not to
 * model a real installation.
 */
const skid=system('boost','Демо · насосная станция');

const psu=simulation('PSU-24','dc-supply',{system:'boost',at:{x:90,y:140}});
const tank=simulation('TK-101','reservoir',{
  system:'boost',at:{x:110,y:620},
  inputs:{inflow:.62,demand:{ref:'P-101.flow'}},
  parameters:{capacity:24,initialLevel:.68},
  history:{level:{deadband:.2,maxInterval:1000,retention:3600000}},
});
const controller=plc('SATURN-DEMO',{
  system:'boost',at:{x:520,y:120},
  setpoints:{
    PUMP:{caption:'Насос P-101',min:0,max:1,initial:1,step:1},
    VALVE:{caption:'Клапан V-101',min:0,max:1,initial:1,step:1},
  },
  blocks:{
    pumpDrive:functionBlock('OR',[gt(pin('AI1'),420),setpoint('PUMP')]),
  },
  outputs:{
    DO1:block('pumpDrive'),
    DO2:setpoint('VALVE'),
  },
  hmi:{
    shell:{auto:true,mode:'compact'},
    title:'Booster skid',
    rows:[
      {label:'Tank level',pin:'AI1'},
      {label:'Pressure',pin:'AI2'},
      {label:'Pump',pin:'DO1'},
      {label:'Valve',pin:'DO2'},
    ],
  },
});
const pump=simulation('P-101','pump',{
  system:'boost',at:{x:430,y:650},
  inputs:{voltage:controller.DO1,resistance:{ref:'F-101.resistance'}},
  parameters:{inertia:1.4,nominalFlow:.9},
  history:{rpm:{deadband:20,maxInterval:1000,retention:3600000},flow:{deadband:.02,maxInterval:1000,retention:3600000}},
});
const filter=simulation('F-101','strainer',{
  system:'boost',at:{x:720,y:650},
  inputs:{flow:pump.flow,impurity:.035,flush:.004},
  parameters:{accumulation:.02},
  history:{fouling:{deadband:.5,maxInterval:2000,retention:3600000}},
});
const accumulator=simulation('AC-101','expansion-vessel',{
  system:'boost',at:{x:1150,y:620},
  inputs:{inflow:pump.flow,outflow:{ref:'V-101.flow'}},
  parameters:{capacity:12,stiffness:1.15},
  history:{pressure:{deadband:.01,maxInterval:1000,retention:3600000},level:{deadband:.5,maxInterval:1000,retention:3600000}},
});
const valve=simulation('V-101','motor-valve',{
  system:'boost',at:{x:950,y:650},
  inputs:{demand:controller.DO2,pressure:accumulator.pressure},
  parameters:{travel:.7,capacity:.58},
  history:{opening:{deadband:1,maxInterval:1000,retention:3600000},flow:{deadband:.01,maxInterval:1000,retention:3600000}},
});
const levelTx=simulation('LT-101','transmitter',{
  system:'boost',at:{x:310,y:360},
  inputs:{value:tank.level},parameters:{gain:10},
});
const pressureTx=simulation('PT-101','transmitter',{
  system:'boost',at:{x:780,y:360},
  inputs:{value:accumulator.pressure},parameters:{gain:100},
});
const module=simulation('IO-EXT','io-module',{system:'boost',at:{x:980,y:220}});
const runLamp=simulation('HL-101','indicator',{
  system:'boost',at:{x:1240,y:180},
  inputs:{voltage:{op:'mul',args:[controller.DO1,24]}},
});

const connections=[
  cable('plc-power-plus',port(psu,'plus'),port(controller,'DC+'),{medium:'power'}),
  cable('plc-power-minus',port(psu,'minus'),port(controller,'DC-'),{medium:'power'}),
  cable('plc-common',port(psu,'minus'),port(controller,'COM1'),{medium:'power'}),
  cable('lt-common',port(psu,'minus'),port(levelTx,'common'),{medium:'power'}),
  cable('pt-common',port(psu,'minus'),port(pressureTx,'common'),{medium:'power'}),
  cable('lt-ai1',port(levelTx,'value'),port(controller,'AI1'),{medium:'control'}),
  cable('pt-ai2',port(pressureTx,'value'),port(controller,'AI2'),{medium:'control'}),
  cable('io-bus-a',port(controller,'RS-A'),port(module,'busA'),{medium:'bus'}),
  cable('io-bus-b',port(controller,'RS-B'),port(module,'busB'),{medium:'bus'}),
  cable('io-power-plus',port(psu,'plus'),port(module,'plus'),{medium:'power'}),
  cable('io-power-minus',port(psu,'minus'),port(module,'minus'),{medium:'power'}),
  pipe('p-tank-pump',port(tank,'outlet'),port(pump,'inlet')),
  pipe('p-pump-filter',port(pump,'outlet'),port(filter,'inlet')),
  pipe('p-filter-valve',port(filter,'outlet'),port(valve,'inlet')),
  pipe('p-valve-acc',port(valve,'outlet'),port(accumulator,'inlet')),
];

export default project('saturn-hmi-showcase',{
  title:'Saturn HMI · Booster Skid',
  description:'Отдельный демонстрационный проект четырёхкнопочного HMI shell и Firmverse display emulator.',
  systems:[skid],
  controllers:[controller],
  simulations:[psu,tank,pump,filter,accumulator,valve,levelTx,pressureTx,module,runLamp],
  connections,
  attachments:[expansion(module,controller,1)],
  controls:[],
  signals:[],
  alarms:[
    alarm('tank-low',{title:'TK-101 · низкий уровень',signal:gt(35,tank.level),above:.5,clearBelow:.1,delay:500,priority:'warning'}),
    alarm('filter-dirty',{title:'F-101 · фильтр загрязнён',signal:filter.fouling,above:72,clearBelow:65,delay:1000,priority:'warning'}),
    alarm('pressure-high',{title:'AC-101 · высокое давление',signal:accumulator.pressure,above:.9,clearBelow:.82,delay:500,priority:'critical'}),
  ],
  reports:[],
  overview:[
    {signal:'TK-101.level',label:'Уровень',unit:'%'},
    {signal:'P-101.rpm',label:'Насос',unit:'rpm'},
    {signal:'AC-101.pressure',label:'Давление',unit:'отн.'},
    {signal:'F-101.fouling',label:'Фильтр',unit:'%'},
  ],
  stepMs:100,
  seed:42,
});
