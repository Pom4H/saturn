import { SATURN_TERMINAL_ANCHORS, SATURN_SERVICE_ANCHORS } from './vendor/saturn/src/view';
import { AppError, type Project, type Device, type Expr } from './types';
export type Medium = 'pipe' | 'power' | 'control' | 'bus';
export type Side = 'left' | 'right' | 'up' | 'down';
export interface Terminal { x:number;y:number;z:number;side:Side;medium:Medium;family:string;role:'source'|'sink'|'passive';max:number;signal?:string;input?:string;failValue?:number; }
export interface Endpoint { device:string;port:string }
export interface Connection { id:string;from:Endpoint;to:Endpoint;medium:Medium;via?:{x:number;y:number}[];signal?:Expr;scale?:number; }
export interface Attachment { device:string;controller:string;slot:number;profile:'virtual-io4' }
const t=(x:number,y:number,side:Side,medium:Medium,family:string,role:Terminal['role'], extra:Partial<Terminal>={}):Terminal=>({x,y,side,medium,family,role,z:.65,max:1,...extra});
const inline = ()=>({ inlet:t(0,48,'left','pipe','water','sink'),outlet:t(150,48,'right','pipe','water','source',{signal:'flow'}) });
const io = ()=>({ value:t(75,8,'up','control','analog','source',{signal:'value'}), common:t(100,8,'up','power','dc0','sink') });
const profiles:Record<string,Record<string,Terminal>>={
    pump:{...inline(),drive:t(75,9,'up','power','drive','sink',{input:'voltage'})},
    turbine:{...inline()},separator:{inlet:t(0,48,'left','pipe','water','sink'),outlet:t(150,48,'right','pipe','steam','source')},
    exchanger:{...inline(),coldIn:t(40,85,'down','pipe','water','sink'),coldOut:t(110,85,'down','pipe','water','source')},
    valve:{...inline(),command:t(75,11,'up','control','analog','sink',{input:'demand'})},
    checkvalve:inline(),filter:inline(),
    tower:{...inline(),drive:t(75,15,'up','power','drive','sink')},
    reservoir:{inlet:t(33,12,'left','pipe','water','sink'),outlet:t(116,75,'right','pipe','water','source',{signal:'flow'})},
    accumulator:{inlet:t(75,97,'down','pipe','water','passive')},
    relief:{inlet:t(75,96,'down','pipe','water','sink'),outlet:t(141,55,'right','pipe','water','source')},
    calorimeter:{inlet:t(0,64,'left','pipe','water','sink'),outlet:t(150,34,'right','pipe','water','source')},
    sensor:io(),control:io(),channel:{...inline()},reactor:{},structure:{},
    generator:{out:t(75,6,'up','power','drive','source',{signal:'voltage'})},
    motor:{power:t(75,5,'up','power','drive','sink'),shaft:t(150,48,'right','power','shaft','source',{signal:'rpm'})},
    fan:{power:t(75,7,'up','power','drive','sink')},
    transformer:{primary:t(45,9,'up','power','drive','sink'),secondary:t(105,9,'up','power','drive','source',{signal:'voltage'})},
    alternator:{shaft:t(0,48,'left','power','shaft','sink'),output:t(75,12,'up','power','drive','source',{signal:'voltage'})},
    battery:{in:t(37,8,'up','power','drive','sink'),out:t(109,8,'up','power','drive','source',{signal:'voltage'})},
    switchgear:{in:t(37,5,'up','power','drive','sink'),out:t(100,5,'up','power','drive','source',{signal:'voltage'})},
    dcSupply:{plus:t(45,12,'up','power','dc24','source',{signal:'voltage',max:16}),minus:t(105,12,'up','power','dc0','source',{signal:'return',max:16})},
    transmitter:{...io()},
    contactor:{coil:t(40,9,'up','control','digital','sink',{input:'coil',failValue:0}),common:t(65,9,'up','power','dc0','sink'),line:t(100,9,'up','power','dc24','sink',{input:'supply'}),out:t(100,86,'down','power','dc24','source',{signal:'voltage'})},
    indicator:{input:t(60,85,'down','power','dc24','sink',{input:'voltage',failValue:0}),common:t(95,85,'down','power','dc0','sink')},
    ioModule:{busA:t(0,25,'left','bus','rs485-A','passive',{max:2}),busB:t(0,65,'left','bus','rs485-B','passive',{max:2}),plus:t(30,8,'up','power','dc24','sink'),minus:t(55,8,'up','power','dc0','sink'),
      ...Object.fromEntries(Array.from({length:4},(_,i)=>['AI'+(i+1),t(140,20+i*20,'right','control','analog','sink',{input:'channel'+(i+1)})]))},
    junction:{inlet:t(0,48,'left','pipe','water','sink'),outlet:t(150,48,'right','pipe','water','source'),branch:t(75,85,'down','pipe','water','source')},
};
profiles.saturn=Object.fromEntries([...SATURN_TERMINAL_ANCHORS.map(a=>[a.id,t(a.x*.5,a.y*.5,a.side==='top'?'up':'down','control',a.signal,a.direction==='input'?'sink':'source',{z:1,max:a.direction==='output'?8:1,signal:a.direction==='output'?a.id:undefined})] as const),
 ...SATURN_SERVICE_ANCHORS.map(a=>[a.id,t(a.x*.5,a.y*.5,a.side==='top'?'up':'down',a.id.startsWith('RS')?'bus':'power',a.family,a.id.startsWith('RS')?'passive':'sink',{z:1})] as const)]);
export function terminals(type:string):Record<string,Terminal>{const p=Object.hasOwn(profiles,type)?profiles[type]:undefined;if(!p)throw new AppError('No physical port profile: '+type);return p;}
export function footprint(type:string){return type==='saturn'?{width:310,height:190}:{width:150,height:118};}
export const physicalTypes=()=>Object.keys(profiles);
export function resolvePort(p:Project,e:Endpoint):{device:Device;terminal:Terminal}{const device=p.devices.find(d=>d.id===e.device);const ports=device&&terminals(device.type);const terminal=ports&&Object.hasOwn(ports,e.port)?ports[e.port]:undefined;if(!device||!terminal)throw new AppError(`Unknown terminal ${e.device}.${e.port}`);return{device,terminal};}
export function validateConnections(p:Project):void {
 if(!Array.isArray(p.connections??[])||(p.connections?.length??0)>512)throw new AppError('At most 512 connections');
 const ids=new Set<string>(),degree=new Map<string,number>();
 for(const w of p.connections??[]){if(!w||!w.from||!w.to||typeof w.from.device!=='string'||typeof w.to.device!=='string'||typeof w.from.port!=='string'||typeof w.to.port!=='string'||!['pipe','power','control','bus'].includes(w.medium))throw new AppError('Malformed physical connection');if(!/^[\w.-]{1,80}$/.test(w.id)||ids.has(w.id))throw new AppError('Invalid or duplicate wire ID');ids.add(w.id);
  const a=resolvePort(p,w.from),b=resolvePort(p,w.to);
  if(w.from.device===w.to.device)throw new AppError('Self-wiring is not supported; use a junction');
  if(a.terminal.medium!==w.medium||b.terminal.medium!==w.medium||a.terminal.family!==b.terminal.family)throw new AppError(`Incompatible connection ${w.id}`);
  if(a.terminal.role==='sink'||b.terminal.role==='source')throw new AppError(`Reversed driver or two sources: ${w.id}`);
  for(const [endpoint,port] of [[w.from,a.terminal],[w.to,b.terminal]] as const){const key=endpoint.device+'.'+endpoint.port;const n=(degree.get(key)??0)+1;degree.set(key,n);if(n>port.max)throw new AppError(`Occupied terminal ${key}; use a distribution terminal`);}
  if(w.scale!==undefined&&(!Number.isFinite(w.scale)||Math.abs(w.scale)>1e6))throw new AppError('Invalid signal scale');
  if(w.medium==='pipe'&&w.scale!==undefined)throw new AppError('Pipe is topology, not signal scaling');
  if(w.via!==undefined&&(!Array.isArray(w.via)||w.via.length>16||w.via.some(v=>!Number.isFinite(v.x)||!Number.isFinite(v.y)||Math.abs(v.x)>15000||Math.abs(v.y)>15000)))throw new AppError('Invalid route points');
 }
 for(const a of p.controllers??[])for(const b of p.controllers??[])if(a.id<b.id&&busConnected(p,{device:a.id,port:'RS-A'},{device:b.id,port:'RS-A'}))throw new AppError('Multiple PLC bus owners are not supported');
 const slots=new Set<string>(),assigned=new Set<string>();
 for(const a of p.attachments??[]){if(a.profile!=='virtual-io4'||!p.controllers?.some(c=>c.id===a.controller)||p.devices.find(d=>d.id===a.device)?.type!=='ioModule'||!Number.isInteger(a.slot)||a.slot<1||a.slot>8||slots.has(a.controller+':'+a.slot)||assigned.has(a.device))throw new AppError('Invalid expansion slot');slots.add(a.controller+':'+a.slot);assigned.add(a.device);}
}
export function connectionExpression(p:Project,w:Connection):Expr|undefined {if(w.signal!==undefined)return w.signal;const {device,terminal}=resolvePort(p,w.from);return terminal.signal?device.signals[terminal.signal]:undefined;}

/** Reachability of declared passive bus conductors, not an RS-485 packet simulator. */
export function busConnected(p:Project,from:Endpoint,to:Endpoint):boolean {
 const key=(e:Endpoint)=>e.device+'\0'+e.port,start=key(from),target=key(to),queue=[start],seen=new Set(queue);
 const adjacency=new Map<string,string[]>();for(const w of p.connections??[])if(w.medium==='bus'){const a=key(w.from),b=key(w.to);adjacency.set(a,[...(adjacency.get(a)??[]),b]);adjacency.set(b,[...(adjacency.get(b)??[]),a]);}
 for(let i=0;i<queue.length;i++){if(queue[i]===target)return true;for(const n of adjacency.get(queue[i])??[])if(!seen.has(n)){seen.add(n);queue.push(n);}}return false;
}
