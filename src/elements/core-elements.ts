import { ComponentRegistry, defineElementPack, type ComponentDefinition, type Port, type Field, defineSchematicElement } from './model';

const positionFields: Record<string, Field> = {
  "x": { "label": "X", "default": 100, "min": -3000, "max": 6000, "step": 1, "unit": "", "scope": "layout" },
  "y": { "label": "Y", "default": 100, "min": -3000, "max": 6000, "step": 1, "unit": "", "scope": "layout" }
};
const statusFields: Record<string, Field> = {
  "quality": { "label": "Качество", "default": "good", "choices": [ "good", "stale", "bad" ] },
  "alarm": { "label": "Состояние", "default": "none", "choices": [ "none", "warning", "trip" ] }
};

const port=(id:string,position:Port['position'],normal:Port['normal'],role:Port['role']='bidirectional',medium='water'):Port=>({id,position,normal,medium,role});
const parameter=(value:number,min:number,max:number,unit='m')=>({default:value,min,max,unit});
const scaleParameter={default:1,min:.6,max:1.6,unit:'ratio'};

export const tank:ComponentDefinition={
type:'process.tank.vertical',
version:"1.0.0",
label:"Резервуар",
parameters:{radius:parameter(.82,.4,1.4),height:parameter(2.2,1,4)},
signals:{
  "level": { "unit": "%", "meaning": "Measured liquid height in the cylindrical working volume", "label": "Уровень", "type": "number" }
},
ports:p=>[port('OUT',[p.radius+.28,0,.48],[1,0,0],'out')],
references:['dexpi:Equipment/Tank','drawio:pid/vessels'],
visual:{glyph:'process.tank.vertical',category:'process',geometry:'process.tank.vertical',envelope:{min:[-.9,-.9,.05],max:[1.15,.9,2.6]},materials:['steel','water'],parts:[{id:'shell',role:'body',importance:1},{id:'liquid',role:'medium',importance:1}],fluids:[{id:'working-volume',medium:'water',role:'contained',signal:'level'},{id:'surface',medium:'water',role:'surface',signal:'level'}]},
schematic:{kind:"tank",width:170,height:230,fields:{
...positionFields,
"level": { "label": "Уровень", "default": 64, "min": 0, "max": 100, "step": 1, "unit": "%" },
...statusFields
},anchors:{
  "outlet": {
    "port": "OUT",
    "at": { "x": 170, "y": 184 }
  }
}}
};
export const pump:ComponentDefinition={
type:'process.pump.centrifugal',
version:"1.0.0",
label:"Насос",
parameters:{scale:scaleParameter},
signals:{
  "rpm": { "unit": "rpm", "meaning": "Measured drive speed, independent of fluid flow", "label": "Обороты двигателя", "type": "number" },
  "flow": { "unit": "m3/h", "meaning": "Signed measured flow, positive IN to OUT", "label": "Расход", "type": "number" },
  "temperature": { "label": "Температура", "type": "number", "unit": "°C" },
  "vibration": { "label": "Вибрация", "type": "number", "unit": "mm/s" }
},
ports:p=>[port('IN',[-.95*p.scale,0,.65*p.scale],[-1,0,0],'in'),port('OUT',[-.25*p.scale,0,1.35*p.scale],[0,0,1],'out')],
references:['dexpi:Equipment/CentrifugalPump','drawio:pid/pumps'],
visual:{glyph:'process.pump.centrifugal',category:'process',geometry:'process.pump.centrifugal',envelope:{min:[-1.05,-.55,.04],max:[1.02,.55,1.45]},materials:['steel','paintedIndustrial'],parts:[{id:'casing',role:'body',importance:1},{id:'rotor',role:'rotor',importance:.75},{id:'motor',role:'actuator',importance:.9}],fluids:[{id:'internal-flow',medium:'water',role:'flow',signal:'flow'}]},
schematic:{kind:"pump",width:220,height:170,fields:{
...positionFields,
"rpm": { "label": "Обороты", "default": 1500, "min": -3000, "max": 3000, "step": 50, "unit": "об/мин" },
"temperature": { "label": "Температура", "default": 48, "min": -40, "max": 150, "step": 1, "unit": "°C" },
"vibration": { "label": "Вибрация", "default": 1.8, "min": 0, "max": 20, "step": 0.1, "unit": "мм/с" },
"nominalFlow": { "label": "Номинальный расход", "default": 12, "min": 0, "max": 100, "step": 0.1, "unit": "м³/ч" },
"degradationRate": { "label": "Скорость износа в сценарии", "default": 0.008, "min": 0, "max": 0.1, "step": 0.001, "unit": "1/с" },
"startDelay": { "label": "Задержка запуска", "default": 1, "min": 0, "max": 30, "step": 0.1, "unit": "с" },
"maintenanceSeconds": { "label": "Длительность обслуживания", "default": 3, "min": 0.1, "max": 60, "step": 0.1, "unit": "с" },
...statusFields
},anchors:{
  "inlet": {
    "port": "IN",
    "at": { "x": 0, "y": 96 }
  },
  "outlet": {
    "port": "OUT",
    "at": { "x": 76, "y": 0 }
  }
}},
commands:{
  "start": { "label": "Запустить" },
  "stop": { "label": "Остановить" },
  "setSpeed": { "label": "Задать обороты", "valueType": "number", "min": -3000, "max": 3000 },
  "service": { "label": "Обслужить" },
  "replace": { "label": "Заменить экземпляр" }
}
};
export const valve:ComponentDefinition={
type:'process.valve.control',
version:"1.0.0",
label:"Клапан",
parameters:{scale:scaleParameter},
signals:{
  "opening": { "unit": "%", "meaning": "Measured valve opening", "label": "Открытие", "type": "number" },
  "flow": { "unit": "m3/h", "meaning": "Signed process flow", "label": "Расход", "type": "number" }
},
ports:p=>[port('IN',[-.72*p.scale,0,.62*p.scale],[-1,0,0],'in'),port('OUT',[.72*p.scale,0,.62*p.scale],[1,0,0],'out')],
references:['drawio:pid/valves','dexpi:Piping'],
visual:{glyph:'process.valve.control',category:'process',geometry:'process.valve.control',envelope:{min:[-.82,-.48,.04],max:[.82,.48,1.55]},materials:['steel','paintedIndustrial'],parts:[{id:'body',role:'body',importance:1},{id:'actuator',role:'actuator',importance:.85},{id:'indicator',role:'display',importance:.65}],fluids:[{id:'internal-flow',medium:'water',role:'flow',signal:'flow'}]},
schematic:{kind:"valve",width:160,height:164,fields:{
...positionFields,
"opening": { "label": "Открытие", "default": 76, "min": 0, "max": 100, "step": 1, "unit": "%" },
...statusFields
},anchors:{
  "inlet": {
    "port": "IN",
    "at": { "x": 0, "y": 102 }
  },
  "outlet": {
    "port": "OUT",
    "at": { "x": 160, "y": 102 }
  }
}},
commands:{
  "setOpening": { "label": "Открытие клапана", "valueType": "number", "min": 0, "max": 100 }
}
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
type:'process.filter.inline',
version:"1.0.0",
label:"Фильтр",
parameters:{scale:scaleParameter},
signals:{
  "flow": { "unit": "m3/h", "meaning": "Signed process flow", "label": "Расход", "type": "number" },
  "differentialPressure": { "unit": "bar", "meaning": "Measured pressure drop across filter", "label": "Перепад давления", "type": "number" }
},
ports:p=>[port('IN',[-.65*p.scale,0,.73*p.scale],[-1,0,0],'in'),port('OUT',[.65*p.scale,0,.73*p.scale],[1,0,0],'out')],
references:['drawio:pid/filters'],
visual:{glyph:'process.filter.inline',category:'process',geometry:'process.filter.inline',envelope:{min:[-.72,-.4,.04],max:[.72,.4,1.28]},materials:['steel'],parts:[{id:'body',role:'body',importance:1},{id:'mesh',role:'body',importance:.7}]},
schematic:{kind:"filter",width:130,height:100,fields:{
"x": { "scope": "layout", "label": "X", "default": 100, "min": -3000, "max": 6000 },
"y": { "scope": "layout", "label": "Y", "default": 100, "min": -3000, "max": 6000 },
"resistance": { "label": "Сопротивление", "default": 0.1, "min": 0, "max": 1, "step": 0.01, "unit": "доля" },
...statusFields
},anchors:{
  "IN": {
    "port": "IN",
    "at": { "x": 0, "y": 44.35483870967742 }
  },
  "OUT": {
    "port": "OUT",
    "at": { "x": 130, "y": 44.35483870967742 }
  }
},prefix:"FLT"},
commands:{
  "clean": { "label": "Очистить фильтр" }
}
};
export const flowmeter:ComponentDefinition={
type:'instrumentation.flowmeter.inline',
version:"1.0.0",
label:"Расходомер",
parameters:{scale:scaleParameter},
signals:{
  "flow": { "unit": "m3/h", "meaning": "Measured signed flow", "label": "Расход", "type": "number" }
},
ports:p=>[port('IN',[-.58*p.scale,0,.62*p.scale],[-1,0,0],'in'),port('OUT',[.58*p.scale,0,.62*p.scale],[1,0,0],'out')],
references:['drawio:pid/instruments'],
visual:{glyph:'instrumentation.flowmeter',category:'instrumentation',geometry:'instrumentation.flowmeter.inline',envelope:{min:[-.68,-.42,.05],max:[.68,.42,1.42]},materials:['steel','glass'],parts:[{id:'body',role:'sensor',importance:1},{id:'display',role:'display',importance:.8}]},
schematic:{kind:"flowmeter",width:96,height:76,fields:{ ...positionFields, ...statusFields },anchors:{
  "inlet": {
    "port": "IN",
    "at": { "x": 0, "y": 38 }
  },
  "outlet": {
    "port": "OUT",
    "at": { "x": 96, "y": 38 }
  }
}}
};
export const exchanger:ComponentDefinition={
type:'process.heat-exchanger.plate',
version:"1.0.0",
label:"Теплообменник",
parameters:{scale:scaleParameter},
signals:{
  "flow": { "unit": "m3/h", "meaning": "Measured process flow", "label": "Расход", "type": "number" },
  "temperature": { "unit": "°C", "meaning": "Measured outlet temperature", "label": "Температура", "type": "number" }
},
ports:p=>[port('IN',[-.7*p.scale,0,.62*p.scale],[-1,0,0],'in'),port('OUT',[.7*p.scale,0,.62*p.scale],[1,0,0],'out')],
references:['drawio:pid/heat-exchangers'],
visual:{glyph:'process.heat-exchanger',category:'process',geometry:'process.heat-exchanger.plate',envelope:{min:[-.78,-.46,.04],max:[.78,.46,1.42]},materials:['steel','paintedIndustrial'],parts:[{id:'plates',role:'body',importance:1}]},
schematic:{kind:"exchanger",width:170,height:170,fields:{
...positionFields,
"temperature": { "label": "Температура", "default": 72, "min": -40, "max": 150, "step": 1, "unit": "°C" },
...statusFields
},anchors:{
  "inlet": {
    "port": "IN",
    "at": { "x": 0, "y": 85 }
  },
  "outlet": {
    "port": "OUT",
    "at": { "x": 170, "y": 85 }
  }
}}
};

export const outlet: ComponentDefinition = defineSchematicElement("outlet", {
  "label": "В систему",
  "width": 44,
  "height": 40,
  "fields": {
    "x": { "label": "X", "default": 100, "min": -3000, "max": 6000, "step": 1, "unit": "", "scope": "layout" },
    "y": { "label": "Y", "default": 100, "min": -3000, "max": 6000, "step": 1, "unit": "", "scope": "layout" },
    "quality": { "label": "Качество", "default": "good", "choices": [ "good", "stale", "bad" ] },
    "alarm": { "label": "Состояние", "default": "none", "choices": [ "none", "warning", "trip" ] }
  },
  "ports": {
    "inlet": { "x": 0, "y": 20, "direction": "left", "role": "in" }
  },
  "visual": {
    "glyph": "process.outlet",
    "category": "process",
    "geometry": "process.outlet",
    "envelope": { "min": [ -0.3, -0.2, 0.05 ], "max": [ 0.35, 0.2, 1.2 ] },
    "materials": [
      "steel"
    ]
  },
  "version": "1.0.0",
  "signals": {
    "flow": { "label": "Расход", "type": "number", "unit": "m3/h" }
  }
});

export const pressure: ComponentDefinition = defineSchematicElement("pressure", {
  "label": "Манометр",
  "width": 66,
  "height": 90,
  "instrument": true,
  "fields": {
    "value": { "label": "Давление", "default": 5.8, "min": 0, "max": 16, "step": 0.1, "unit": "бар" },
    "at": { "label": "Точка отвода", "default": 0.6, "min": 0.1, "max": 0.9, "step": 0.05, "unit": "", "scope": "layout" },
    "offset": { "label": "Отступ", "default": 100, "min": 80, "max": 240, "step": 10, "unit": "", "scope": "layout" },
    "quality": { "label": "Качество", "default": "good", "choices": [ "good", "stale", "bad" ] },
    "alarm": { "label": "Состояние", "default": "none", "choices": [ "none", "warning", "trip" ] }
  },
  "ports": {},
  "visual": {
    "glyph": "instrumentation.pressure",
    "category": "instrumentation",
    "geometry": "instrumentation.pressure",
    "envelope": { "min": [ -0.36, -0.2, 0.05 ], "max": [ 0.36, 0.2, 1.5 ] },
    "materials": [
      "steel",
      "glass"
    ]
  },
  "version": "1.0.0",
  "signals": {
    "value": { "label": "Давление", "type": "number", "unit": "bar" }
  }
});

export const temperature: ComponentDefinition = defineSchematicElement("temperature", {
  "label": "Термометр",
  "width": 70,
  "height": 70,
  "instrument": true,
  "fields": {
    "value": { "label": "Температура", "default": 72, "min": -40, "max": 150, "step": 1, "unit": "°C" },
    "at": { "label": "Точка отвода", "default": 0.5, "min": 0.1, "max": 0.9, "step": 0.05, "unit": "", "scope": "layout" },
    "offset": { "label": "Отступ", "default": 95, "min": 80, "max": 240, "step": 10, "unit": "", "scope": "layout" },
    "quality": { "label": "Качество", "default": "good", "choices": [ "good", "stale", "bad" ] },
    "alarm": { "label": "Состояние", "default": "none", "choices": [ "none", "warning", "trip" ] }
  },
  "ports": {},
  "visual": {
    "glyph": "instrumentation.temperature",
    "category": "instrumentation",
    "geometry": "instrumentation.temperature",
    "envelope": { "min": [ -0.32, -0.2, 0.05 ], "max": [ 0.32, 0.2, 1.5 ] },
    "materials": [
      "steel",
      "glass"
    ]
  },
  "version": "1.0.0",
  "signals": {
    "value": { "label": "Температура", "type": "number", "unit": "°C" }
  }
});

export const coreElementPack=defineElementPack({id:'@saturn/core-elements',version:'1.0.0',title:'Saturn Core Elements',elements:[tank,pump,valve,flowmeter,exchanger,outlet,pressure,temperature,filter,threeWayValve]});
export const registry=new ComponentRegistry().registerPack(coreElementPack);
