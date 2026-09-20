import * as React from 'react';
import { generatePlcShell, shellPage, sample, type PlcShellPage } from '../plc-shell';
import type { Frame, Project } from '../types';

export interface SaturnPlcHmiProps {
  project: Project;
  frame: Frame;
  controllerId: string;
}

const h = React.createElement;
const C = {
  bg: '#06141b',
  panel: '#0b232d',
  panel2: '#102f3a',
  line: '#284d59',
  text: '#effcff',
  muted: '#7fa8b4',
  cyan: '#36d8e7',
  green: '#49d49f',
  amber: '#ffc75f',
  red: '#ff6b72',
  water: '#16a8d8',
  water2: '#42d5f5',
};

const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const pct=(value:number|null)=>value===null?0:clamp(value<=1?value*100:value,0,100);
const fmt=(value:number|null,digits=0)=>value===null?'—':value.toFixed(digits);
const safeId=(value:string)=>value.replace(/[^A-Za-z0-9_-]/g,'-');
const controller=(project:Project,id:string)=>project.controllers?.find(item=>item.id===id);
const systemDevices=(project:Project,id:string)=>{
  const c=controller(project,id);
  return c?project.devices.filter(device=>device.system===c.system&&device.id!==id):[];
};
const byType=(project:Project,id:string,type:string)=>systemDevices(project,id).find(device=>device.type===type);
const signal=(frame:Frame,id:string,key:string)=>sample(frame,id+'.'+key);

function text(key:string,x:number,y:number,value:React.ReactNode,size=10,fill=C.text,weight=600,anchor:'start'|'middle'|'end'='start'){
  return h('text',{key,x,y,fill,fontSize:size,fontFamily:'Inter,system-ui,sans-serif',fontWeight:weight,textAnchor:anchor},value);
}
function mono(key:string,x:number,y:number,value:React.ReactNode,size=11,fill=C.text,anchor:'start'|'middle'|'end'='start'){
  return h('text',{key,x,y,fill,fontSize:size,fontFamily:'ui-monospace,SFMono-Regular,Menlo,monospace',fontWeight:650,textAnchor:anchor},value);
}
function roundedRect(key:string,x:number,y:number,width:number,height:number,fill:string,stroke=C.line,r=7,extra:Record<string,unknown>={}){
  return h('rect',{key,x,y,width,height,rx:r,fill,stroke,strokeWidth:1,...extra});
}
function header(page:PlcShellPage,index:number,total:number){
  return h(React.Fragment,null,
    h('rect',{x:0,y:0,width:320,height:31,fill:'#081b24'}),
    h('rect',{x:0,y:30,width:320,height:1,fill:'#19404d'}),
    text('brand',11,13,'SATURN',8,C.cyan,800),
    text('title',11,25,page.title,12,C.text,750),
    mono('count',304,20,`${index+1}/${total}`,8,C.muted,'end'),
  );
}
function footer(hint:string){
  return h(React.Fragment,null,
    h('rect',{x:0,y:211,width:320,height:29,fill:'#081b24'}),
    h('rect',{x:0,y:211,width:320,height:1,fill:'#19404d'}),
    mono('hint',12,229,hint,8,C.muted),
  );
}
function tankVisual(id:string,level:number|null,x:number,y:number,width:number,height:number,time:number,large=false){
  const fill=pct(level),inner=height-10,waterH=inner*fill/100,waterY=y+height-5-waterH;
  const phase=(time/350)%12;
  const wave=`M${x+5} ${waterY+2} q10 ${-3+Math.sin(phase)*2} 20 0 t20 0 t20 0 t20 0`;
  return h('g',{'data-equipment':id},
    h('rect',{x,y,width,height,rx:large?12:8,fill:'#0a1d25',stroke:'#507784',strokeWidth:2}),
    h('rect',{x:x+5,y:waterY,width:width-10,height:waterH,rx:4,fill:'url(#plc-water)',opacity:.82,'data-water':true}),
    h('path',{d:wave,stroke:C.water2,strokeWidth:2,fill:'none',opacity:fill>2?.9:0}),
    h('line',{x1:x+8,y1:y+height*.35,x2:x+width-8,y2:y+height*.35,stroke:'#234955',strokeWidth:1}),
    h('line',{x1:x+8,y1:y+height*.65,x2:x+width-8,y2:y+height*.65,stroke:'#234955',strokeWidth:1}),
  );
}
function rotorBlades(cx:number,cy:number,r:number){
  const nodes:React.ReactNode[]=[];
  for(let i=0;i<6;i++){
    nodes.push(h('path',{key:i,d:`M ${cx} ${cy} C ${cx+r*.22} ${cy-r*.08} ${cx+r*.75} ${cy-r*.48} ${cx+r*.78} ${cy-r*.14} C ${cx+r*.8} ${cy+r*.08} ${cx+r*.38} ${cy+r*.22} ${cx+r*.12} ${cy+r*.16} Z`,fill:i%2?C.cyan:'#278a9b',transform:`rotate(${i*60} ${cx} ${cy})`}));
  }
  nodes.push(h('circle',{key:'hub',cx,cy,r:r*.14,fill:'#e4fbff'}));
  return nodes;
}
function pumpVisual(id:string,rpm:number|null,x:number,y:number,r:number){
  const running=(rpm??0)>20;
  const seconds=running?clamp(72/Math.max(120,rpm??120),.12,1.2):1;
  return h('g',{'data-equipment':id},
    h('circle',{cx:x,cy:y,r:r+5,fill:'#071a22',stroke:'#426c79',strokeWidth:2}),
    h('circle',{cx:x,cy:y,r,fill:'url(#plc-pump)',stroke:'#2d9bac',strokeWidth:1}),
    h('g',{'data-rotor':true,style:{transformBox:'fill-box',transformOrigin:'center',animation:running?`plcHmiSpin ${seconds}s linear infinite`:'none'}},...rotorBlades(x,y,r*.8)),
    h('circle',{cx:x,cy:y,r:r*.2,fill:'#0a2730',stroke:'#6be7f1',strokeWidth:1}),
  );
}
function lampVisual(id:string,on:boolean,x:number,y:number,r:number,time:number){
  const pulse=on?.72+.18*Math.sin(time/180):.1;
  return h('g',{'data-equipment':id,'data-on':String(on)},
    h('circle',{cx:x,cy:y,r:r+12,fill:C.green,opacity:on?pulse:.03,filter:on?'url(#plc-glow)':undefined}),
    h('circle',{cx:x,cy:y,r,fill:on?'url(#plc-lamp)':'#263c45',stroke:on?'#b9ffe6':'#55717b',strokeWidth:2}),
    h('circle',{cx:x-r*.25,cy:y-r*.28,r:r*.18,fill:'#fff',opacity:on?.72:.08}),
  );
}
function processScreen(project:Project,frame:Frame,controllerId:string,page:PlcShellPage,index:number,total:number){
  const pump=byType(project,controllerId,'pump'),tank=byType(project,controllerId,'reservoir'),lamp=byType(project,controllerId,'indicator');
  const rpm=pump?signal(frame,pump.id,'rpm'):null,flow=pump?signal(frame,pump.id,'flow'):null,level=tank?signal(frame,tank.id,'level'):null;
  const out=signal(frame,controllerId,'DO1'),light=lamp?signal(frame,lamp.id,'brightness'):out,on=(light??0)>.5;
  const moving=(flow??0)>.01||(rpm??0)>20||on;
  const duration=moving?clamp(1.4/(Math.abs(flow??0)+.35),.25,1.1):1;
  return h('g',{className:'plc-hmi-page',key:page.id,'data-hmi-page':page.id},
    header(page,index,total),
    text('mode',12,47,'PROCESS',8,C.cyan,800),
    tankVisual(tank?.id??'TANK',level,18,70,68,100,frame.time),
    text('tank-name',52,185,tank?.id??'TANK',8,C.muted,700,'middle'),
    mono('tank-level',52,198,`${fmt(pct(level))}%`,10,C.text,'middle'),
    h('path',{d:'M86 121 H126 M194 121 H241',stroke:'#335762',strokeWidth:10,strokeLinecap:'round',fill:'none'}),
    h('path',{d:'M86 121 H126 M194 121 H241',stroke:C.cyan,strokeWidth:4,strokeLinecap:'round',fill:'none',strokeDasharray:'11 9',opacity:moving?.95:.18,'data-flow':true,style:{animation:moving?`plcHmiFlow ${duration}s linear infinite`:'none'}}),
    pumpVisual(pump?.id??'PUMP',rpm,160,121,30),
    text('pump-name',160,174,pump?.id??'PUMP',8,C.muted,700,'middle'),
    mono('pump-rpm',160,188,`${fmt(rpm)} rpm`,9,C.text,'middle'),
    roundedRect('relay',222,99,25,44,on?'#164d42':'#172c34',on?C.green:'#46646e',5),
    text('relay-t',234.5,125,'R',11,on?C.green:C.muted,800,'middle'),
    lampVisual(lamp?.id??'LOAD',on,279,121,19,frame.time),
    text('load-name',279,158,lamp?.id??'LOAD',8,C.muted,700,'middle'),
    mono('flow-value',111,203,`FLOW ${fmt(flow,2)}`,8,moving?C.cyan:C.muted),
    mono('io-value',302,203,`DO1 ${out===null?'—':out>.5?'ON':'OFF'}`,8,on?C.green:C.muted,'end'),
    footer('< overview   > object   DN I/O'),
  );
}
function pumpDetail(project:Project,frame:Frame,controllerId:string,page:Extract<PlcShellPage,{kind:'device'}>,index:number,total:number){
  const id=page.deviceId,rpm=signal(frame,id,'rpm'),flow=signal(frame,id,'flow'),power=signal(frame,id,'power'),driver=page.driver?signal(frame,controllerId,page.driver):null;
  const on=(driver??rpm??0)>.5;
  return h('g',{className:'plc-hmi-page',key:page.id,'data-hmi-page':page.id},
    header(page,index,total),
    text('kind',12,47,'CENTRIFUGAL PUMP',8,C.cyan,800),
    pumpVisual(id,rpm,177,119,53),
    roundedRect('rpm-card',12,69,77,39,C.panel2),text('rpm-l',20,84,'RPM',7,C.muted,700),mono('rpm-v',20,101,fmt(rpm),15,C.text),
    roundedRect('flow-card',12,115,77,39,C.panel2),text('flow-l',20,130,'FLOW',7,C.muted,700),mono('flow-v',20,147,fmt(flow,2),15,C.cyan),
    roundedRect('pwr-card',12,161,77,35,C.panel2),text('pwr-l',20,175,'POWER',7,C.muted,700),mono('pwr-v',20,191,fmt(power,2),12,C.text),
    roundedRect('state',244,71,62,30,on?'#123d35':C.panel2,on?C.green:C.line,15),text('state-t',275,90,on?'RUN':'STOP',9,on?C.green:C.muted,800,'middle'),
    h('path',{d:'M238 130 h58',stroke:on?C.cyan:C.line,strokeWidth:4,strokeDasharray:'8 7',style:{animation:on?'plcHmiFlow .55s linear infinite':'none'}}),
    text('ctrl',275,151,page.controlSetpoint?'UP START':'MONITOR',7,C.muted,700,'middle'),
    text('ctrl2',275,166,page.controlSetpoint?'DN STOP':'< BACK',7,C.muted,700,'middle'),
    footer('< process   > next   UP/DN control'),
  );
}
function tankDetail(frame:Frame,page:Extract<PlcShellPage,{kind:'device'}>,index:number,total:number){
  const level=signal(frame,page.deviceId,'level'),fill=pct(level);
  return h('g',{className:'plc-hmi-page',key:page.id,'data-hmi-page':page.id},
    header(page,index,total),
    text('kind',12,47,'RESERVOIR',8,C.cyan,800),
    tankVisual(page.deviceId,level,89,59,142,133,frame.time,true),
    roundedRect('level-card',18,82,58,53,C.panel2),
    text('level-l',47,99,'LEVEL',7,C.muted,700,'middle'),
    mono('level-v',47,122,fmt(fill),17,C.text,'middle'),
    text('level-u',47,132,'%',7,C.muted,700,'middle'),
    h('line',{x1:244,y1:70,x2:244,y2:187,stroke:C.line,strokeWidth:5,strokeLinecap:'round'}),
    h('line',{x1:244,y1:187-(117*fill/100),x2:244,y2:187,stroke:C.water2,strokeWidth:5,strokeLinecap:'round'}),
    mono('level-top',286,78,'100',7,C.muted,'end'),
    mono('level-mid',286,131,'50',7,C.muted,'end'),
    mono('level-bot',286,188,'0',7,C.muted,'end'),
    footer('< process   > next   monitor only'),
  );
}
function indicatorDetail(frame:Frame,page:Extract<PlcShellPage,{kind:'device'}>,index:number,total:number){
  const value=signal(frame,page.deviceId,'brightness'),on=(value??0)>.5;
  return h('g',{className:'plc-hmi-page',key:page.id,'data-hmi-page':page.id},
    header(page,index,total),
    text('kind',12,47,'INDICATOR',8,C.cyan,800),
    lampVisual(page.deviceId,on,160,119,54,frame.time),
    mono('state',160,194,on?'ON':'OFF',15,on?C.green:C.muted,'middle'),
    footer('< process   > next'),
  );
}
function genericDevice(project:Project,frame:Frame,page:Extract<PlcShellPage,{kind:'device'}>,index:number,total:number){
  const device=project.devices.find(item=>item.id===page.deviceId);
  const keys=Object.keys(device?.signals??{}).slice(0,4);
  return h('g',{className:'plc-hmi-page',key:page.id,'data-hmi-page':page.id},
    header(page,index,total),
    text('kind',12,47,page.visual.toUpperCase(),8,C.cyan,800),
    roundedRect('device',68,67,184,93,'url(#plc-panel)',C.line,12),
    h('circle',{cx:102,cy:113,r:20,fill:'#102d36',stroke:C.cyan,strokeWidth:2}),
    h('circle',{cx:102,cy:113,r:6,fill:C.cyan,opacity:.8}),
    text('device-id',135,102,page.deviceId,12,C.text,800),
    text('device-type',135,121,page.visual,8,C.muted,700),
    ...keys.map((key,n)=>mono('sig-'+key,28,180+n*10,`${key.toUpperCase()} ${fmt(signal(frame,page.deviceId,key),1)}`,8,n===0?C.cyan:C.muted)),
    footer('< process   > next'),
  );
}
function ioScreen(project:Project,frame:Frame,controllerId:string,page:Extract<PlcShellPage,{kind:'io'}>,index:number,total:number){
  const items=page.signals.slice(0,6);
  return h('g',{className:'plc-hmi-page',key:page.id,'data-hmi-page':page.id},
    header(page,index,total),
    text('kind',12,47,'LIVE I/O',8,C.cyan,800),
    ...items.flatMap((name,n)=>{
      const x=n%2?165:12,y=58+Math.floor(n/2)*46,v=signal(frame,controllerId,name),digital=/^[D][IO]/.test(name),on=(v??0)!==0;
      return [
        roundedRect('io-'+n,x,y,143,37,on&&digital?'#123d35':C.panel2,on&&digital?C.green:C.line,7),
        text('iol-'+n,x+10,y+15,name,8,C.muted,750),
        mono('iov-'+n,x+132,y+25,v===null?'—':digital?(on?'ON':'OFF'):fmt(v),13,on&&digital?C.green:C.text,'end'),
      ];
    }),
    footer('< overview   UP process   > network'),
  );
}
function networkScreen(frame:Frame,controllerId:string,page:Extract<PlcShellPage,{kind:'network'}>,index:number,total:number){
  const healthy=(sample(frame,controllerId+'.healthy')??0)>.5,peer=page.peers[0]??'NO PEER';
  return h('g',{className:'plc-hmi-page',key:page.id,'data-hmi-page':page.id},
    header(page,index,total),
    text('kind',12,47,'NETWORK',8,C.cyan,800),
    roundedRect('local',16,76,108,64,C.panel2,healthy?C.green:C.red,9),
    text('local-title',28,95,'SATURN PLC',8,C.muted,750),
    mono('local-id',28,119,controllerId,10,C.text),
    h('line',{x1:124,y1:108,x2:194,y2:108,stroke:C.line,strokeWidth:4}),
    h('line',{x1:124,y1:108,x2:194,y2:108,stroke:C.cyan,strokeWidth:2,strokeDasharray:'7 6',style:{animation:'plcHmiFlow .7s linear infinite'}}),
    h('circle',{cx:142,cy:108,r:5,fill:C.text,filter:'url(#plc-glow)',style:{animation:'plcHmiPacket 1.6s ease-in-out infinite'}}),
    roundedRect('peer',194,76,110,64,C.panel2,page.peers.length?C.cyan:C.line,9),
    text('peer-title',206,95,page.peers.length?'PEER':'BUS',8,C.muted,750),
    mono('peer-id',206,119,peer,9,page.peers.length?C.text:C.muted),
    roundedRect('health',16,157,288,34,healthy?'#0e332e':'#351b20',healthy?'#286c5b':'#7e3038',7),
    text('health-label',28,178,healthy?'LINK / RUNTIME HEALTHY':'LINK / RUNTIME DEGRADED',9,healthy?C.green:C.red,750),
    footer('< overview   UP process   DN I/O'),
  );
}

export function SaturnPlcHmi({project,frame,controllerId}:SaturnPlcHmiProps){
  const model=generatePlcShell(project,controllerId),index=frame.controllerScreens?.[controllerId]??0,page=shellPage(model,index);
  let body:React.ReactNode;
  if(page.kind==='overview'||page.kind==='process')body=processScreen(project,frame,controllerId,page,index,model.pages.length);
  else if(page.kind==='io')body=ioScreen(project,frame,controllerId,page,index,model.pages.length);
  else if(page.kind==='network')body=networkScreen(frame,controllerId,page,index,model.pages.length);
  else if(page.visual==='pump'||page.visual==='motor'||page.visual==='fan')body=pumpDetail(project,frame,controllerId,page,index,model.pages.length);
  else if(page.visual==='reservoir')body=tankDetail(frame,page,index,model.pages.length);
  else if(page.visual==='indicator')body=indicatorDetail(frame,page,index,model.pages.length);
  else body=genericDevice(project,frame,page,index,model.pages.length);
  const id=safeId(controllerId);
  return h(React.Fragment,null,
    h('defs',null,
      h('linearGradient',{id:'plc-bg-'+id,x1:'0',y1:'0',x2:'1',y2:'1'},h('stop',{offset:'0%',stopColor:'#06141b'}),h('stop',{offset:'100%',stopColor:'#0a222c'})),
      h('linearGradient',{id:'plc-water',x1:'0',y1:'0',x2:'0',y2:'1'},h('stop',{offset:'0%',stopColor:C.water2}),h('stop',{offset:'100%',stopColor:C.water})),
      h('radialGradient',{id:'plc-pump'},h('stop',{offset:'0%',stopColor:'#173a43'}),h('stop',{offset:'100%',stopColor:'#0a2028'})),
      h('radialGradient',{id:'plc-lamp'},h('stop',{offset:'0%',stopColor:'#d9fff0'}),h('stop',{offset:'35%',stopColor:'#5cf0b1'}),h('stop',{offset:'100%',stopColor:'#1c9a6e'})),
      h('linearGradient',{id:'plc-panel',x1:'0',y1:'0',x2:'1',y2:'1'},h('stop',{offset:'0%',stopColor:'#102f3a'}),h('stop',{offset:'100%',stopColor:'#0a2028'})),
      h('filter',{id:'plc-glow',x:'-100%',y:'-100%',width:'300%',height:'300%'},h('feGaussianBlur',{stdDeviation:4,result:'b'}),h('feMerge',null,h('feMergeNode',{in:'b'}),h('feMergeNode',{in:'SourceGraphic'}))),
    ),
    h('style',null,`
      @keyframes plcHmiSpin{to{transform:rotate(360deg)}}
      @keyframes plcHmiFlow{to{stroke-dashoffset:-40}}
      @keyframes plcHmiPacket{0%{transform:translateX(0);opacity:.2}15%{opacity:1}85%{opacity:1}100%{transform:translateX(48px);opacity:.2}}
      @keyframes plcHmiEnter{from{opacity:.15;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
      .plc-hmi-page{animation:plcHmiEnter .18s ease-out}
    `),
    h('rect',{x:0,y:0,width:320,height:240,fill:`url(#plc-bg-${id})`}),
    h('g',{'data-react-plc-hmi':true,'data-controller-id':controllerId},body),
  );
}
