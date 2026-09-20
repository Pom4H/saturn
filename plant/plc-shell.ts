import type { ControllerKey } from './controller';
import type { Frame, Project, Device } from './types';

export type PlcShellPage =
  | { id:'overview'; kind:'overview'; title:string }
  | { id:'process'; kind:'process'; title:string; devices:string[] }
  | { id:string; kind:'device'; title:string; deviceId:string; visual:string }
  | { id:'io'; kind:'io'; title:string }
  | { id:'network'; kind:'network'; title:string; peers:string[] };

export interface PlcShellModel {
  controllerId:string;
  title:string;
  pages:PlcShellPage[];
  systemDevices:string[];
}

const interesting = new Set(['pump','reservoir','valve','indicator','contactor','transmitter','ioModule','motor','fan','tower']);

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
  const detail=ordered.filter(device=>interesting.has(device.type)).sort((a,b)=>(detailPriority[a.type]??99)-(detailPriority[b.type]??99)||a.x-b.x||a.id.localeCompare(b.id)).slice(0,8);
  const peers=[
    ...(project.attachments??[]).filter(item=>item.controller===controllerId).map(item=>item.device),
    ...[...connected].filter(id=>project.devices.find(device=>device.id===id)?.type==='ioModule'),
  ];
  const pages:PlcShellPage[]=[
    {id:'overview',kind:'overview',title:system?.title??controllerId},
    {id:'process',kind:'process',title:'Процесс',devices:ordered.slice(0,8).map(device=>device.id)},
    ...detail.map(device=>({id:'device:'+device.id,kind:'device' as const,title:device.id,deviceId:device.id,visual:device.type})),
    {id:'io',kind:'io',title:'I/O'},
    {id:'network',kind:'network',title:'Сеть',peers:[...new Set(peers)]},
  ];
  return {controllerId,title:controller.hmi.title||controllerId,pages,systemDevices:ordered.map(device=>device.id)};
}

export function shellPage(model:PlcShellModel,index:number):PlcShellPage {
  const safe=((index%model.pages.length)+model.pages.length)%model.pages.length;
  return model.pages[safe];
}

export function shellKey(project:Project,controllerId:string,current:number,key:ControllerKey):{screen:number;setpoint?:string;value?:number} {
  const model=generatePlcShell(project,controllerId), page=shellPage(model,current);
  if(page.kind==='device' && key==='up') {
    const controller=project.controllers!.find(item=>item.id===controllerId)!;
    const name=Object.keys(controller.setpoints??{})[0];
    if(name) return {screen:current,setpoint:name,value:1};
  }
  if(page.kind==='device' && key==='down') {
    const controller=project.controllers!.find(item=>item.id===controllerId)!;
    const name=Object.keys(controller.setpoints??{})[0];
    if(name) return {screen:current,setpoint:name,value:0};
  }
  if(key==='right'||key==='down') return {screen:(current+1)%model.pages.length};
  if(key==='left'||key==='up') return {screen:(current-1+model.pages.length)%model.pages.length};
  return {screen:current};
}

export function sample(frame:Frame,id:string):number|null {
  const value=frame.samples[id];
  return value?.quality==='good'&&typeof value.value==='number'?value.value:null;
}

export function deviceSignal(project:Project,device:Device,key:string):string|undefined {
  return Object.hasOwn(device.signals,key)?device.id+'.'+key:undefined;
}
