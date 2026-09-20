import type { ControllerKey } from './controller';
import type { Device, Expr, Frame, Project } from './types';
import type { HmiElementModel, HmiScreenModel } from './vendor/saturn/src/types';
import { HMI_COLOR } from './vendor/saturn/src/hmi';

export type PlcShellPage =
  | { id:'overview'; kind:'overview'; title:string }
  | { id:'process'; kind:'process'; title:string; devices:string[] }
  | { id:string; kind:'device'; title:string; deviceId:string; visual:string; driver?:string; controlSetpoint?:string }
  | { id:'io'; kind:'io'; title:string; signals:string[] }
  | { id:'network'; kind:'network'; title:string; peers:string[] };

export interface PlcShellModel {
  controllerId:string;
  title:string;
  pages:PlcShellPage[];
  systemDevices:string[];
  inputs:string[];
  outputs:string[];
}

const interesting = new Set(['pump','reservoir','valve','indicator','contactor','transmitter','ioModule','motor','fan','tower']);
const inputPin = /^(?:AI[12]|DI(?:[1-9]|10))$/;
const displayText=(value:string)=>value
  .replace(/[·•]/g,'/')
  .replace(/→/g,'>')
  .replace(/←/g,'<')
  .replace(/↑/g,'UP')
  .replace(/↓/g,'DN')
  .replace(/[–—]/g,'-');
const clip=(value:string,max:number)=>{
  const safe=displayText(value);
  return safe.length<=max?safe:safe.slice(0,Math.max(1,max-2))+'..';
};
const uniq=<T>(items:T[])=>[...new Set(items)];

function refs(expr:Expr | undefined, controller:any, result:Set<string>, seen=new Set<string>()):void {
  if(expr===undefined||typeof expr==='number'||typeof expr==='boolean')return;
  if('ref' in expr){
    const ref=expr.ref;
    if(inputPin.test(ref))result.add(ref);
    const block=controller.blocks?.[ref];
    if(block&&!seen.has(ref)){seen.add(ref);for(const nested of block.inputs??[])refs(nested,controller,result,seen);}
    return;
  }
  for(const nested of expr.args??[])refs(nested,controller,result,seen);
}
function usesRef(expr:Expr | undefined, target:string, controller:any, seen=new Set<string>()):boolean {
  if(expr===undefined||typeof expr==='number'||typeof expr==='boolean')return false;
  if('ref' in expr){
    if(expr.ref===target)return true;
    const block=controller.blocks?.[expr.ref];
    if(block&&!seen.has(expr.ref)){seen.add(expr.ref);return (block.inputs??[]).some((nested:Expr)=>usesRef(nested,target,controller,seen));}
    return false;
  }
  return (expr.args??[]).some(nested=>usesRef(nested,target,controller,seen));
}
function expressionRefs(expr:Expr | undefined,result:Set<string>):void {
  if(expr===undefined||typeof expr==='number'||typeof expr==='boolean')return;
  if('ref' in expr){result.add(expr.ref);return;}
  for(const nested of expr.args??[])expressionRefs(nested,result);
}
function deviceDriver(project:Project,controllerId:string,deviceId:string,outputs:string[]):string|undefined {
  const simulation=project.simulations.find(item=>item.id===deviceId);
  if(simulation){
    const found=new Set<string>();
    for(const expr of Object.values(simulation.inputs))expressionRefs(expr,found);
    const direct=outputs.find(pin=>found.has(controllerId+'.'+pin));
    if(direct)return direct;
  }
  for(const wire of project.connections??[]){
    if(wire.from.device===controllerId&&wire.to.device===deviceId&&outputs.includes(wire.from.port))return wire.from.port;
  }
  return undefined;
}
function setpointForOutput(controller:any,pin:string|undefined):string|undefined {
  if(!pin)return undefined;
  return Object.keys(controller.setpoints??{}).find(name=>usesRef(controller.outputs?.[pin],name,controller));
}

export function generatePlcShell(project:Project, controllerId:string):PlcShellModel {
  const controller=project.controllers?.find(item=>item.id===controllerId);
  if(!controller) throw new Error('Unknown PLC shell controller: '+controllerId);
  const system=project.systems.find(item=>item.id===controller.system);
  const systemDevices=project.devices
    .filter(device=>device.system===controller.system && device.id!==controllerId)
    .sort((a,b)=>a.layout.x-b.layout.x||a.layout.y-b.layout.y||a.id.localeCompare(b.id));
  const connected=new Set<string>();
  for(const wire of project.connections??[]) {
    if(wire.from.device===controllerId) connected.add(wire.to.device);
    if(wire.to.device===controllerId) connected.add(wire.from.device);
  }
  const ordered=[...systemDevices].sort((a,b)=>Number(connected.has(b.id))-Number(connected.has(a.id))||a.layout.x-b.layout.x||a.id.localeCompare(b.id));
  const detailPriority:Record<string,number>={pump:0,reservoir:1,valve:2,motor:3,fan:4,contactor:5,indicator:6,transmitter:7,ioModule:8,tower:9};
  const outputs=Object.keys(controller.outputs??{}).sort();
  const inputs=new Set<string>();
  for(const expr of Object.values(controller.outputs??{}))refs(expr,controller,inputs);
  for(const row of controller.hmi.rows??[])if(inputPin.test(row.pin))inputs.add(row.pin);
  const detail=ordered.filter(device=>interesting.has(device.type)).sort((a,b)=>(detailPriority[a.type]??99)-(detailPriority[b.type]??99)||a.layout.x-b.layout.x||a.id.localeCompare(b.id)).slice(0,8);
  const peers=uniq([
    ...(project.attachments??[]).filter(item=>item.controller===controllerId).map(item=>item.device),
    ...[...connected].filter(id=>project.devices.find(device=>device.id===id)?.type==='ioModule'),
  ]);
  const ioSignals=[...inputs].sort().concat(outputs);
  const compact=controller.hmi.shell?.mode==='compact';
  const detailPages=detail.map(device=>{
      const driver=deviceDriver(project,controllerId,device.id,outputs);
      return {id:'device.'+device.id,kind:'device' as const,title:device.id,deviceId:device.id,visual:device.type,driver,controlSetpoint:setpointForOutput(controller,driver)};
    });
  const pages:PlcShellPage[]=compact?[
    {id:'overview',kind:'overview',title:system?.title??controllerId},
    ...detailPages,
    {id:'io',kind:'io',title:'I/O',signals:ioSignals},
    {id:'network',kind:'network',title:'Сеть',peers},
  ]:[
    {id:'overview',kind:'overview',title:system?.title??controllerId},
    {id:'process',kind:'process',title:'Процесс',devices:uniq([...detail.map(device=>device.id),...ordered.map(device=>device.id)]).slice(0,6)},
    ...detailPages,
    {id:'io',kind:'io',title:'I/O',signals:ioSignals},
    {id:'network',kind:'network',title:'Сеть',peers},
  ];
  return {controllerId,title:controller.hmi.title||controllerId,pages,systemDevices:ordered.map(device=>device.id),inputs:[...inputs].sort(),outputs};
}

export function shellPage(model:PlcShellModel,index:number):PlcShellPage {
  const safe=((index%model.pages.length)+model.pages.length)%model.pages.length;
  return model.pages[safe];
}
const indexOf=(model:PlcShellModel,id:string,fallback:number)=>{const found=model.pages.findIndex(page=>page.id===id);return found<0?fallback:found;};

export function shellKey(project:Project,controllerId:string,current:number,key:ControllerKey):{screen:number;setpoint?:string;value?:number} {
  const model=generatePlcShell(project,controllerId), safe=((current%model.pages.length)+model.pages.length)%model.pages.length, page=shellPage(model,safe);
  const process=indexOf(model,'process',safe), io=indexOf(model,'io',safe), network=indexOf(model,'network',safe);
  const compact=project.controllers?.find(item=>item.id===controllerId)?.hmi.shell?.mode==='compact';
  if(page.kind==='overview'){
    const first=model.pages.findIndex(item=>item.kind==='device');
    if(key==='right')return{screen:compact&&first>=0?first:process};if(key==='down')return{screen:io};if(key==='up')return{screen:network};return{screen:safe};
  }
  if(page.kind==='process'){
    const first=model.pages.findIndex(item=>item.kind==='device');
    if(key==='left')return{screen:indexOf(model,'overview',safe)};if(key==='right')return{screen:first>=0?first:io};if(key==='down')return{screen:io};if(key==='up')return{screen:network};return{screen:safe};
  }
  if(page.kind==='device'){
    if(page.controlSetpoint&&(key==='up'||key==='down')){
      const sp=project.controllers!.find(item=>item.id===controllerId)!.setpoints?.[page.controlSetpoint];
      if(sp)return{screen:safe,setpoint:page.controlSetpoint,value:key==='up'?sp.max:sp.min};
    }
    if(key==='left')return{screen:compact?indexOf(model,'overview',safe):process};
    if(key==='right'){
      const next=model.pages.slice(safe+1).findIndex(item=>item.kind==='device');
      return{screen:next>=0?safe+1+next:(compact?indexOf(model,'overview',safe):process)};
    }
    return{screen:safe};
  }
  if(page.kind==='io'){
    if(key==='left')return{screen:indexOf(model,'overview',safe)};if(key==='right'||key==='down')return{screen:network};if(key==='up')return{screen:compact?indexOf(model,'overview',safe):process};return{screen:safe};
  }
  if(key==='left')return{screen:indexOf(model,'overview',safe)};
  if(key==='right'||key==='up')return{screen:compact?indexOf(model,'overview',safe):process};
  if(key==='down')return{screen:io};
  return{screen:safe};
}

const at=(id:string,primitive:HmiElementModel['primitive'],x:number,y:number,extra:Omit<HmiElementModel,'id'|'primitive'|'position'>={}):HmiElementModel=>({id,primitive,position:{x,y},...extra});
const text=(id:string,label:string,x:number,y:number,font:number=0,color:number=HMI_COLOR.TEXT)=>at(id,'text',x,y,{label:clip(label,font===1?20:38),font,color});
const header=(page:PlcShellPage,index:number,total:number):HmiElementModel[]=>[
  at('head','rect',0,0,{width:320,height:32,color:HMI_COLOR.HEADER}),
  text('title',page.title,10,7,1), text('count',`${index+1}/${total}`,274,10,0,HMI_COLOR.ACCENT),
];
const footer=(hint:string):HmiElementModel[]=>[
  at('foot','rect',0,212,{width:320,height:28,color:HMI_COLOR.HEADER}),
  text('hint',hint,10,220,0,HMI_COLOR.MUTED),
];
const binding=(ref:string,format:'bool'|'int'|'fixed1'|'fixed2'='int')=>({source:(ref.startsWith('AI')||ref.startsWith('DI'))?'input' as const:'output' as const,ref,format});
function overviewElements(model:PlcShellModel,page:PlcShellPage,index:number):HmiElementModel[]{
  const input=model.inputs[0],output=model.outputs[0];
  const body:HmiElementModel[]=[text('tag','AUTO SHELL · PLC',12,45,0,HMI_COLOR.ACCENT),text('controller',model.controllerId,12,65,1)];
  if(input)body.push(text('in-label',input,14,101),at('in','value',92,96,{label:'',font:1,binding:binding(input)}));
  else body.push(text('no-in','Нет используемых входов',14,101,0,HMI_COLOR.MUTED));
  if(output)body.push(text('out-label',output,14,137),at('out','status',92,137,{label:'',binding:binding(output,'bool')}));
  else body.push(text('no-out','Нет выходов',14,137,0,HMI_COLOR.MUTED));
  body.push(text('devices',`Устройств: ${model.systemDevices.length}`,14,178));
  return [...header(page,index,model.pages.length),...body,...footer('→ процесс   ↓ I/O   ↑ сеть')];
}
function processElements(project:Project,model:PlcShellModel,page:Extract<PlcShellPage,{kind:'process'}>,index:number):HmiElementModel[]{
  const devices=page.devices.slice(0,3), body:HmiElementModel[]=[text('tag','ТЕХПРОЦЕСС',12,44,0,HMI_COLOR.ACCENT)];
  const xs=[52,160,268];
  devices.forEach((id,n)=>{
    const device=project.devices.find(item=>item.id===id),x=xs[n]!;
    if(n>0){body.push(at('pipe'+n,'line',xs[n-1]!+26,112,{width:x-xs[n-1]!-52,height:0,strokeWidth:5,color:HMI_COLOR.MUTED}));}
    if(device?.type==='reservoir')body.push(at('shape'+n,'rect',x-24,82,{width:48,height:62,color:HMI_COLOR.MUTED}));
    else body.push(at('shape'+n,'indicator',x-22,88,{width:44,height:44,color:HMI_COLOR.MUTED}));
    const detail=model.pages.find(item=>item.kind==='device'&&item.deviceId===id) as Extract<PlcShellPage,{kind:'device'}>|undefined;
    if(detail?.driver){
      body.push(at('active'+n,'indicator',x-16,94,{width:32,height:32,color:HMI_COLOR.ACCENT,visible:{cond:'eq',ref:detail.driver,value:1}}));
    }
    body.push(text('label'+n,clip(id,12),Math.max(4,x-36),151));
  });
  const input=model.inputs[0],output=model.outputs[0];
  if(input)body.push(at('proc-in','value',16,181,{label:input+' ',binding:binding(input),font:1}));
  if(output)body.push(at('proc-out','status',174,184,{label:output+' ',binding:binding(output,'bool')}));
  return [...header(page,index,model.pages.length),...body,...footer('← обзор   → объект   ↓ I/O')];
}
function deviceElements(model:PlcShellModel,page:Extract<PlcShellPage,{kind:'device'}>,index:number):HmiElementModel[]{
  const body:HmiElementModel[]=[text('kind',page.visual.toUpperCase(),12,44,0,HMI_COLOR.ACCENT)];
  if(page.visual==='pump'||page.visual==='motor'||page.visual==='fan'){
    body.push(at('machine','indicator',112,70,{width:96,height:96,color:HMI_COLOR.MUTED}));
    body.push(at('shaft','line',132,118,{width:56,height:0,strokeWidth:4,color:HMI_COLOR.TEXT}));
    body.push(at('blade-a','line',160,90,{width:0,height:56,strokeWidth:3,color:HMI_COLOR.TEXT}));
  } else if(page.visual==='reservoir'){
    body.push(at('tank','rect',104,66,{width:112,height:108,color:HMI_COLOR.MUTED}));
  } else {
    body.push(at('device','rect',92,74,{width:136,height:88,color:HMI_COLOR.MUTED}));
  }
  if(page.driver){
    body.push(at('driver-label','status',16,180,{label:page.driver+' ',binding:binding(page.driver,'bool'),font:1}));
    body.push(at('driver-active','indicator',244,76,{width:44,height:44,color:HMI_COLOR.ACCENT,visible:{cond:'eq',ref:page.driver,value:1}}));
  } else body.push(text('observe','Нет PLC-управления',16,184,0,HMI_COLOR.MUTED));
  const hint=page.controlSetpoint?'← процесс   ↑ ВКЛ   ↓ ВЫКЛ':'← процесс   → след. объект';
  return [...header(page,index,model.pages.length),...body,...footer(hint)];
}
function ioElements(model:PlcShellModel,page:Extract<PlcShellPage,{kind:'io'}>,index:number):HmiElementModel[]{
  const body:HmiElementModel[]=[];
  const shown=page.signals.slice(0,6);
  shown.forEach((name,n)=>{
    const y=46+n*26, isDigital=name.startsWith('DI')||name.startsWith('DO');
    body.push(text('io-label'+n,name,16,y));
    body.push(at('io-value'+n,isDigital?'status':'value',116,y,{label:'',binding:binding(name,isDigital?'bool':'int'),font:isDigital?0:1}));
  });
  if(page.signals.length>shown.length)body.push(text('io-more',`+${page.signals.length-shown.length} каналов`,220,190,0,HMI_COLOR.MUTED));
  if(!shown.length)body.push(text('io-empty','Нет используемых I/O',16,82,0,HMI_COLOR.MUTED));
  return [...header(page,index,model.pages.length),...body,...footer('← обзор   ↑ процесс   → сеть')];
}
function networkElements(model:PlcShellModel,page:Extract<PlcShellPage,{kind:'network'}>,index:number):HmiElementModel[]{
  const body:HmiElementModel[]=[text('net-tag','ПОДКЛЮЧЕНИЯ',12,46,0,HMI_COLOR.ACCENT),at('plc','rect',18,72,{width:112,height:56,color:HMI_COLOR.HEADER}),text('plc-name',model.controllerId,29,91)];
  if(page.peers.length){
    body.push(at('link','line',130,100,{width:62,height:0,strokeWidth:2,color:HMI_COLOR.ACCENT}),at('peer','rect',192,72,{width:110,height:56,color:HMI_COLOR.HEADER}),text('peer-name',page.peers[0]!,202,91));
    page.peers.slice(1,4).forEach((peer,n)=>body.push(text('peer'+n,'• '+peer,20,148+n*18)));
  } else body.push(text('no-peers','Нет подключённых модулей',20,148,0,HMI_COLOR.MUTED));
  return [...header(page,index,model.pages.length),...body,...footer('← обзор   ↑ процесс   ↓ I/O')];
}

export function generatePlcShellScreens(project:Project,controllerId:string):HmiScreenModel[] {
  const model=generatePlcShell(project,controllerId);
  return model.pages.map((page,index)=>{
    let elements:HmiElementModel[];
    if(page.kind==='overview')elements=overviewElements(model,page,index);
    else if(page.kind==='process')elements=processElements(project,model,page,index);
    else if(page.kind==='device')elements=deviceElements(model,page,index);
    else if(page.kind==='io')elements=ioElements(model,page,index);
    else elements=networkElements(model,page,index);
    return {id:page.id,title:page.title,screenType:page.kind==='io'||page.kind==='network'?'diagnostics':page.kind==='device'?'manual':'main',backgroundColor:HMI_COLOR.BG,period:100,elements};
  });
}

export function sample(frame:Frame,id:string):number|null {
  const value=frame.samples[id];
  return value?.quality==='good'&&typeof value.value==='number'?value.value:null;
}

export function deviceSignal(project:Project,device:Device,key:string):string|undefined {
  return Object.hasOwn(device.signals,key)?device.id+'.'+key:undefined;
}
