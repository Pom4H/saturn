import type { Frame, Project } from './types';
import { generatePlcShell, shellPage, sample } from './plc-shell';

type Cache = { key:string; pageId:string };
const cache = new WeakMap<SVGSVGElement,Cache>();
const esc=(value:string)=>value.replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
const n=(value:number|null,digits=0)=>value===null?'—':value.toFixed(digits);
const id=(value:string)=>value.replace(/[^A-Za-z0-9_-]/g,'-');

function style(){
 return `<style>
 .ps-bg{fill:#071820}.ps-panel{fill:#0c2731;stroke:#24505d;stroke-width:1}.ps-card{fill:#10333e;stroke:#2c5f6d;stroke-width:1}
 .ps-title{fill:#effcff;font:700 15px system-ui}.ps-sub{fill:#8cc4cf;font:500 8px system-ui}.ps-label{fill:#a4cad2;font:600 8px system-ui}
 .ps-value{fill:#fff;font:700 12px ui-monospace,monospace}.ps-ok{fill:#39d29f}.ps-warn{fill:#ffcc66}.ps-line{stroke:#4b7d88;stroke-width:8;fill:none;stroke-linecap:round}
 .ps-flow{stroke:#3fd8e8;stroke-width:4;stroke-dasharray:12 8;fill:none;animation:psflow .7s linear infinite}.ps-flow.off{opacity:.2;animation:none}
 .ps-rotor{transform-box:fill-box;transform-origin:center}.ps-rotor.run{animation:psspin .55s linear infinite}.ps-lamp{fill:#31464e;stroke:#71909a;stroke-width:2}.ps-lamp.on{fill:#52e39f;filter:drop-shadow(0 0 7px #52e39f)}
 .ps-water{fill:#27a9d3;opacity:.8;transition:y .25s,height .25s}.ps-chip{fill:#123844;stroke:#2d6878}.ps-chip.active{fill:#164d49;stroke:#39d29f}
 .ps-btn{fill:#123944;stroke:#356775}.ps-net{stroke:#3fd8e8;stroke-width:2;stroke-dasharray:5 5;animation:psflow .8s linear infinite}
 .ps-packet{fill:#fff;filter:drop-shadow(0 0 3px #3fd8e8);animation:pspacket 1.4s linear infinite}
 @keyframes psspin{to{transform:rotate(360deg)}}@keyframes psflow{to{stroke-dashoffset:-20}}@keyframes pspacket{0%{transform:translateX(0)}100%{transform:translateX(110px)}}
 </style>`;
}
function shellChrome(title:string,sub:string,page:number,total:number,body:string){
 return `${style()}<rect class="ps-bg" width="320" height="240"/><rect class="ps-panel" x="0" y="0" width="320" height="32"/>
 <text class="ps-title" x="10" y="20">${esc(title)}</text><text class="ps-sub" x="246" y="13">${page+1}/${total}</text><text class="ps-sub" x="246" y="24">←  ↑ ↓  →</text>
 <text class="ps-sub" x="10" y="43">${esc(sub)}</text>${body}`;
}
function rotor(cx:number,cy:number,r=24){
 const blades=Array.from({length:6},(_,i)=>`<path d="M${cx} ${cy} q18 -8 20 3 l-15 7z" fill="#264c57" transform="rotate(${i*60} ${cx} ${cy})"/>`).join('');
 return `<g data-rotor class="ps-rotor">${blades}<circle cx="${cx}" cy="${cy}" r="5" fill="#d9eef2"/></g>`;
}
function processBody(project:Project,frame:Frame,controllerId:string){
 const pump=project.devices.find(d=>d.system===project.controllers!.find(c=>c.id===controllerId)!.system&&d.type==='pump');
 const tank=project.devices.find(d=>d.system===project.controllers!.find(c=>c.id===controllerId)!.system&&d.type==='reservoir');
 const lamp=project.devices.find(d=>d.system===project.controllers!.find(c=>c.id===controllerId)!.system&&d.type==='indicator');
 const rpm=pump?sample(frame,pump.id+'.rpm'):null,flow=pump?sample(frame,pump.id+'.flow'):null,level=tank?sample(frame,tank.id+'.level'):null,light=lamp?sample(frame,lamp.id+'.brightness'):sample(frame,controllerId+'.DO1');
 const fill=Math.max(0,Math.min(100,level??0)), y=158-(fill*.72), h=fill*.72;
 return `<g><rect x="18" y="78" width="66" height="80" rx="9" class="ps-card"/><rect data-water class="ps-water" x="23" y="${y}" width="56" height="${h}" rx="4"/>
 <text class="ps-label" x="27" y="71">${esc(tank?.id??'TANK')}</text><text data-level class="ps-value" x="32" y="177">${n(level)}%</text>
 <path class="ps-line" d="M84 120 H126 M184 120 H232"/><path data-flow class="ps-flow ${(flow??0)>.02?'':'off'}" d="M84 120 H126 M184 120 H232"/>
 <circle cx="155" cy="120" r="31" class="ps-card"/>${rotor(155,120)}<text class="ps-label" x="132" y="75">${esc(pump?.id??'PUMP')}</text>
 <text data-rpm class="ps-value" x="126" y="174">${n(rpm)} rpm</text><circle data-lamp cx="266" cy="120" r="20" class="ps-lamp ${(light??0)>.5?'on':''}"/>
 <text class="ps-label" x="247" y="154">${esc(lamp?.id??'LOAD')}</text><text data-flow-value class="ps-sub" x="122" y="193">FLOW ${n(flow,2)}</text>
 <rect x="12" y="205" width="296" height="24" rx="7" class="ps-card"/><text class="ps-sub" x="21" y="220">AUTO SHELL · topology + live bindings · ↑/↓ control on device pages</text></g>`;
}
function deviceBody(project:Project,frame:Frame,deviceId:string,controllerId:string){
 const device=project.devices.find(d=>d.id===deviceId)!;
 if(device.type==='pump'){
   const rpm=sample(frame,device.id+'.rpm'),flow=sample(frame,device.id+'.flow'),power=sample(frame,device.id+'.power');
   return `<circle cx="160" cy="119" r="55" class="ps-card"/>${rotor(160,119,40)}
   <text class="ps-label" x="18" y="65">CENTRIFUGAL PUMP</text><text class="ps-value" x="18" y="86">RPM <tspan data-rpm>${n(rpm)}</tspan></text>
   <text class="ps-value" x="18" y="105">FLOW <tspan data-flow-value>${n(flow,2)}</tspan></text><text class="ps-value" x="18" y="124">PWR <tspan data-power>${n(power,2)}</tspan></text>
   <rect x="18" y="184" width="284" height="42" rx="8" class="ps-card"/><text class="ps-label" x="29" y="201">PHYSICAL KEYS</text><text class="ps-value" x="29" y="218">↑ START / MANUAL ON     ↓ STOP</text>`;
 }
 if(device.type==='reservoir'){
   const level=sample(frame,device.id+'.level'),fill=Math.max(0,Math.min(100,level??0)),y=178-fill*1.15,h=fill*1.15;
   return `<rect x="91" y="58" width="138" height="120" rx="13" class="ps-card"/><rect data-water class="ps-water" x="98" y="${y}" width="124" height="${h}" rx="7"/>
   <text class="ps-value" x="116" y="207">LEVEL <tspan data-level>${n(level)}</tspan>%</text><text class="ps-label" x="95" y="52">BUFFER TANK</text>`;
 }
 if(device.type==='indicator'){
   const value=sample(frame,device.id+'.brightness'),on=(value??0)>.5;
   return `<circle data-lamp cx="160" cy="116" r="54" class="ps-lamp ${on?'on':''}"/><text class="ps-value" x="122" y="198">${on?'ON':'OFF'}</text><text class="ps-label" x="119" y="54">INDICATOR</text>`;
 }
 const signals=Object.keys(device.signals).slice(0,6);
 return signals.map((key,i)=>`<rect x="18" y="${58+i*27}" width="284" height="22" rx="6" class="ps-card"/><text class="ps-label" x="28" y="${73+i*27}">${esc(key)}</text><text class="ps-value" x="220" y="${73+i*27}" data-generic="${esc(device.id+'.'+key)}">—</text>`).join('');
}
function ioBody(frame:Frame,controllerId:string){
 const names=['AI1','AI2','DI1','DI2','DO1','DO2'];
 return names.map((name,i)=>{const v=sample(frame,controllerId+'.'+name),on=(v??0)!==0;return `<rect x="${18+(i%2)*150}" y="${58+Math.floor(i/2)*45}" width="136" height="34" rx="8" class="ps-chip ${on?'active':''}" data-io="${name}"/><text class="ps-label" x="${29+(i%2)*150}" y="${73+Math.floor(i/2)*45}">${name}</text><text class="ps-value" x="${99+(i%2)*150}" y="${79+Math.floor(i/2)*45}" data-io-value="${name}">${n(v)}</text>`;}).join('')+
 `<text class="ps-sub" x="18" y="215">Exact FBD pin image · bad quality is never coerced to zero</text>`;
}
function networkBody(peers:string[],healthy:boolean){
 const peer=peers[0]??'REMOTE-IO';
 return `<rect x="22" y="77" width="92" height="64" rx="10" class="ps-chip active"/><text class="ps-label" x="35" y="96">SATURN PLC</text><text class="ps-value" x="35" y="120">10.42.0.10</text>
 <line x1="114" y1="109" x2="224" y2="109" class="ps-net"/><circle cx="125" cy="109" r="5" class="ps-packet"/>
 <rect x="224" y="77" width="76" height="64" rx="10" class="ps-chip ${healthy?'active':''}"/><text class="ps-label" x="234" y="96">${esc(peer)}</text><text class="ps-value" x="234" y="120">TCP</text>
 <text class="ps-label" x="22" y="166">VIRTUAL LAN</text><text class="ps-value" x="22" y="187">MODBUS/TCP  ${healthy?'LINK':'DOWN'}</text>
 <text class="ps-sub" x="22" y="210">deterministic transport · request/response · fault injection ready</text>`;
}
function build(svg:SVGSVGElement,project:Project,frame:Frame,controllerId:string,index:number){
 const model=generatePlcShell(project,controllerId),page=shellPage(model,index);
 let body='';
 if(page.kind==='overview'||page.kind==='process') body=processBody(project,frame,controllerId);
 else if(page.kind==='device') body=deviceBody(project,frame,page.deviceId,controllerId);
 else if(page.kind==='io') body=ioBody(frame,controllerId);
 else body=networkBody(page.peers,(sample(frame,controllerId+'.healthy')??0)>.5);
 svg.innerHTML=shellChrome(page.title,model.title,index%model.pages.length,model.pages.length,body);
 return {key:controllerId+'|'+page.id,pageId:page.id};
}
export function drawPlcShell(svg:SVGSVGElement,project:Project,frame:Frame,controllerId:string,index=0){
 const model=generatePlcShell(project,controllerId),page=shellPage(model,index),key=controllerId+'|'+page.id;
 if(cache.get(svg)?.key!==key) cache.set(svg,build(svg,project,frame,controllerId,index));
 const pump=project.devices.find(d=>d.system===project.controllers!.find(c=>c.id===controllerId)!.system&&d.type==='pump');
 const tank=project.devices.find(d=>d.system===project.controllers!.find(c=>c.id===controllerId)!.system&&d.type==='reservoir');
 const rpm=pump?sample(frame,pump.id+'.rpm'):null,flow=pump?sample(frame,pump.id+'.flow'):null,level=tank?sample(frame,tank.id+'.level'):null;
 const rotor=svg.querySelector<SVGGElement>('[data-rotor]');if(rotor)rotor.setAttribute('class','ps-rotor '+((rpm??0)>20?'run':''));
 for(const node of svg.querySelectorAll<SVGTextElement>('[data-rpm]'))node.textContent=n(rpm);
 for(const node of svg.querySelectorAll<SVGTextElement>('[data-flow-value]'))node.textContent=node.textContent?.startsWith('FLOW ')?'FLOW '+n(flow,2):n(flow,2);
 for(const node of svg.querySelectorAll<SVGTextElement>('[data-level]'))node.textContent=n(level);
 const water=svg.querySelector<SVGRectElement>('[data-water]');if(water&&level!==null){const fill=Math.max(0,Math.min(100,level)),base=page.kind==='device'?178:158,scale=page.kind==='device'?1.15:.72;water.setAttribute('y',String(base-fill*scale));water.setAttribute('height',String(fill*scale));}
 const flowNode=svg.querySelector<SVGPathElement>('[data-flow]');if(flowNode)flowNode.setAttribute('class','ps-flow '+((flow??0)>.02?'':'off'));
 const lamp=svg.querySelector<SVGCircleElement>('[data-lamp]');if(lamp){const controller=project.controllers?.find(c=>c.id===controllerId),system=controller?.system;const v=system?project.devices.find(d=>d.type==='indicator'&&d.system===system):undefined;const current=v?sample(frame,v.id+'.brightness'):sample(frame,controllerId+'.DO1');const on=(current??0)>.5;lamp.setAttribute('class','ps-lamp '+(on?'on':''));}
 for(const node of svg.querySelectorAll<SVGTextElement>('[data-generic]'))node.textContent=n(sample(frame,node.dataset.generic!));
 for(const chip of svg.querySelectorAll<SVGRectElement>('[data-io]')){const key=chip.dataset.io;if(!key)continue;const v=sample(frame,controllerId+'.'+key);chip.setAttribute('class','ps-chip '+((v??0)!==0?'active':''));}
 for(const node of svg.querySelectorAll<SVGTextElement>('[data-io-value]'))const key=node.dataset.ioValue;if(key)node.textContent=n(sample(frame,controllerId+'.'+key));
}
