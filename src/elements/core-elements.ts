import { ComponentRegistry, defineElementPack, type ComponentDefinition, type Port } from './model';

const port=(id:string,position:Port['position'],normal:Port['normal'],role:Port['role']='bidirectional',medium='water'):Port=>({id,position,normal,medium,role});
const parameter=(value:number,min:number,max:number,unit='m')=>({default:value,min,max,unit});
const scaleParameter={default:1,min:.6,max:1.6,unit:'ratio'};

export const tank:ComponentDefinition={
 type:'process.tank.vertical',version:1,label:'Vertical tank',
 parameters:{radius:parameter(.82,.4,1.4),height:parameter(2.2,1,4)},
 signals:{level:{unit:'%',meaning:'Measured liquid height in the cylindrical working volume'}},
 ports:p=>[port('OUT',[p.radius+.28,0,.48],[1,0,0],'out')],
 references:['dexpi:Equipment/Tank','drawio:pid/vessels'],
 visual:{glyph:'process.tank.vertical',category:'process',geometry:'process.tank.vertical',envelope:{min:[-.9,-.9,.05],max:[1.15,.9,2.6]},materials:['steel','water'],parts:[{id:'shell',role:'body',importance:1},{id:'liquid',role:'medium',importance:1}],fluids:[{id:'working-volume',medium:'water',role:'contained',signal:'level'},{id:'surface',medium:'water',role:'surface',signal:'level'}]},
};
export const pump:ComponentDefinition={
 type:'process.pump.centrifugal',version:1,label:'Centrifugal pump',
 parameters:{scale:scaleParameter},
 signals:{rpm:{unit:'rpm',meaning:'Measured drive speed, independent of fluid flow'},flow:{unit:'m3/h',meaning:'Signed measured flow, positive IN to OUT'}},
 ports:p=>[port('IN',[-.95*p.scale,0,.65*p.scale],[-1,0,0],'in'),port('OUT',[-.25*p.scale,0,1.35*p.scale],[0,0,1],'out')],
 references:['dexpi:Equipment/CentrifugalPump','drawio:pid/pumps'],
 visual:{glyph:'process.pump.centrifugal',category:'process',geometry:'process.pump.centrifugal',envelope:{min:[-1.05,-.55,.04],max:[1.02,.55,1.45]},materials:['steel','paintedIndustrial'],parts:[{id:'casing',role:'body',importance:1},{id:'rotor',role:'rotor',importance:.75},{id:'motor',role:'actuator',importance:.9}],fluids:[{id:'internal-flow',medium:'water',role:'flow',signal:'flow'}]},
};
export const valve:ComponentDefinition={
 type:'process.valve.control',version:1,label:'Control valve',
 parameters:{scale:scaleParameter},
 signals:{opening:{unit:'%',meaning:'Measured valve opening'},flow:{unit:'m3/h',meaning:'Signed process flow'}},
 ports:p=>[port('IN',[-.72*p.scale,0,.62*p.scale],[-1,0,0],'in'),port('OUT',[.72*p.scale,0,.62*p.scale],[1,0,0],'out')],
 references:['drawio:pid/valves','dexpi:Piping'],
 visual:{glyph:'process.valve.control',category:'process',geometry:'process.valve.control',envelope:{min:[-.82,-.48,.04],max:[.82,.48,1.55]},materials:['steel','paintedIndustrial'],parts:[{id:'body',role:'body',importance:1},{id:'actuator',role:'actuator',importance:.85},{id:'indicator',role:'display',importance:.65}],fluids:[{id:'internal-flow',medium:'water',role:'flow',signal:'flow'}]},
};
export const threeWayValve:ComponentDefinition={
 type:'process.valve.three-way.diverting',version:1,label:'Three-way diverting valve',
 parameters:{scale:scaleParameter},
 signals:{position:{unit:'%',meaning:'Measured actuator travel; not a flow split'},command:{unit:'%',meaning:'Requested actuator position'},flowAB:{unit:'m3/h',meaning:'Positive into common port AB'},flowA:{unit:'m3/h',meaning:'Positive out of A'},flowB:{unit:'m3/h',meaning:'Positive out of B'}},
 ports:p=>[port('AB',[-.75*p.scale,0,.65*p.scale],[-1,0,0],'in'),port('A',[.75*p.scale,0,.65*p.scale],[1,0,0],'out'),port('B',[0,-.75*p.scale,.65*p.scale],[0,-1,0],'out')],
 references:['drawio:pid/valves','dexpi:Piping'],
 visual:{glyph:'process.valve.control',category:'process',geometry:'process.valve.three-way.diverting',envelope:{min:[-.85,-.85,.04],max:[.85,.48,1.58]},materials:['steel','paintedIndustrial'],parts:[{id:'body',role:'body',importance:1},{id:'actuator',role:'actuator',importance:.85}]},
};
export const filter:ComponentDefinition={
 type:'process.filter.inline',version:1,label:'Inline filter',
 parameters:{scale:scaleParameter},
 signals:{flow:{unit:'m3/h',meaning:'Signed process flow'},differentialPressure:{unit:'bar',meaning:'Measured pressure drop across filter'}},
 ports:p=>[port('IN',[-.65*p.scale,0,.73*p.scale],[-1,0,0],'in'),port('OUT',[.65*p.scale,0,.73*p.scale],[1,0,0],'out')],
 references:['drawio:pid/filters'],
 visual:{glyph:'process.filter.inline',category:'process',geometry:'process.filter.inline',envelope:{min:[-.72,-.4,.04],max:[.72,.4,1.28]},materials:['steel'],parts:[{id:'body',role:'body',importance:1},{id:'mesh',role:'body',importance:.7}]},
};
export const flowmeter:ComponentDefinition={
 type:'instrumentation.flowmeter.inline',version:1,label:'Inline flow meter',parameters:{scale:scaleParameter},
 signals:{flow:{unit:'m3/h',meaning:'Measured signed flow'}},
 ports:p=>[port('IN',[-.58*p.scale,0,.62*p.scale],[-1,0,0],'in'),port('OUT',[.58*p.scale,0,.62*p.scale],[1,0,0],'out')],
 references:['drawio:pid/instruments'],
 visual:{glyph:'instrumentation.flowmeter',category:'instrumentation',geometry:'instrumentation.flowmeter.inline',envelope:{min:[-.68,-.42,.05],max:[.68,.42,1.42]},materials:['steel','glass'],parts:[{id:'body',role:'sensor',importance:1},{id:'display',role:'display',importance:.8}]},
};
export const exchanger:ComponentDefinition={
 type:'process.heat-exchanger.plate',version:1,label:'Plate heat exchanger',parameters:{scale:scaleParameter},
 signals:{flow:{unit:'m3/h',meaning:'Measured process flow'},temperature:{unit:'°C',meaning:'Measured outlet temperature'}},
 ports:p=>[port('IN',[-.7*p.scale,0,.62*p.scale],[-1,0,0],'in'),port('OUT',[.7*p.scale,0,.62*p.scale],[1,0,0],'out')],
 references:['drawio:pid/heat-exchangers'],
 visual:{glyph:'process.heat-exchanger',category:'process',geometry:'process.heat-exchanger.plate',envelope:{min:[-.78,-.46,.04],max:[.78,.46,1.42]},materials:['steel','paintedIndustrial'],parts:[{id:'plates',role:'body',importance:1}]},
};

export const coreElementPack=defineElementPack({id:'@saturn/core-elements',version:'1.0.0',title:'Saturn Core Elements',elements:[tank,pump,valve,threeWayValve,filter,flowmeter,exchanger]});
export const registry=new ComponentRegistry().registerPack(coreElementPack);
