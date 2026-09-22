import { generatePlcShell, shellPage, type PlcShellPage } from '../plc-shell';
import type { Frame, Project } from '../types';
import {
  SaturnDisplayEmulator,
  type DisplayDrawCommand,
  type DisplayNode,
  type DisplaySignals,
  type SaturnDisplayScene,
} from '../vendor/firmverse/display';

export interface SaturnPlcHmiProps {
  project: Project;
  frame: Frame;
  controllerId: string;
}

const rgb565=(r:number,g:number,b:number)=>((Math.round(r*31/255)&31)<<11)|((Math.round(g*63/255)&63)<<5)|(Math.round(b*31/255)&31);
const C={
  bg:rgb565(5,18,25),panel:rgb565(12,37,47),panel2:rgb565(16,49,60),line:rgb565(42,78,90),
  text:rgb565(239,252,255),muted:rgb565(128,169,181),cyan:rgb565(54,216,231),green:rgb565(73,212,159),
  amber:rgb565(255,199,95),red:rgb565(255,107,114),water:rgb565(22,168,216),water2:rgb565(66,213,245),
  dark:rgb565(6,24,31),white:0xffff,
};
const css565=(c:number)=>`rgb(${Math.round((c>>11&31)*255/31)},${Math.round((c>>5&63)*255/63)},${Math.round((c&31)*255/31)})`;
const controller=(project:Project,id:string)=>project.controllers?.find(item=>item.id===id);
const systemDevices=(project:Project,id:string)=>{const c=controller(project,id);return c?project.devices.filter(d=>d.system===c.system&&d.id!==id):[];};
const byType=(project:Project,id:string,type:string)=>systemDevices(project,id).find(device=>device.type===type);
const sig=(id:string,key:string)=>id+'.'+key;

const rect=(id:string,x:number,y:number,width:number,height:number,fill=C.panel2,stroke=C.line,radius=7):DisplayNode=>({id,kind:'rect',x,y,width,height,fill,stroke,strokeWidth:1,radius});
const line=(id:string,x1:number,y1:number,x2:number,y2:number,color=C.line,width=1):DisplayNode=>({id,kind:'line',x1,y1,x2,y2,color,width});
const text=(id:string,x:number,y:number,value:string,size=10,color=C.text,weight=600,align:'start'|'middle'|'end'='start',mono=false):DisplayNode=>({id,kind:'text',x,y,text:value,color,size,weight,align,mono});
const readout=(id:string,x:number,y:number,signal:string,prefix='',suffix='',digits=0,size=11,color=C.text,align:'start'|'middle'|'end'='start',scale=1):DisplayNode=>({
  id,kind:'text',x,y,text:{value:{signal,scale},prefix,suffix,digits},color,size,weight:650,align,mono:true,
});
const boolText=(id:string,x:number,y:number,signal:string,prefix='',on='ON',off='OFF',size=9,color=C.text,align:'start'|'middle'|'end'='start'):DisplayNode=>({
  id,kind:'text',x,y,text:{value:{signal},prefix,on,off},color,size,weight:700,align,mono:true,
});
function header(page:PlcShellPage,index:number,total:number):DisplayNode[]{
  return[
    rect('header-bg',0,0,320,31,rgb565(8,27,36),rgb565(8,27,36),0),
    line('header-rule',0,30,320,30,rgb565(25,64,77),1),
    text('brand',11,13,'SATURN',8,C.cyan,800),
    text('title',11,25,page.title,12,C.text,750),
    text('count',304,20,`${index+1}/${total}`,8,C.muted,600,'end',true),
  ];
}
function footer(hint:string):DisplayNode[]{
  return[
    rect('footer-bg',0,211,320,29,rgb565(8,27,36),rgb565(8,27,36),0),
    line('footer-rule',0,211,320,211,rgb565(25,64,77),1),
    text('footer-hint',12,229,hint,8,C.muted,600,'start',true),
  ];
}
function overview(project:Project,frame:Frame,controllerId:string,page:PlcShellPage,index:number,total:number):SaturnDisplayScene{
  const pump=byType(project,controllerId,'pump'),tank=byType(project,controllerId,'reservoir'),lamp=byType(project,controllerId,'indicator');
  const level=tank?sig(tank.id,'level'):sig(controllerId,'AI1'),rpm=pump?sig(pump.id,'rpm'):sig(controllerId,'AI1'),flow=pump?sig(pump.id,'flow'):sig(controllerId,'DO1'),load=lamp?sig(lamp.id,'brightness'):sig(controllerId,'DO1');
  return{background:C.bg,nodes:[
    ...header(page,index,total),
    text('overview-kicker',12,48,'SYSTEM OVERVIEW',8,C.cyan,800),
    rect('overview-card-a',12,63,91,61,C.panel2),text('overview-a-label',22,80,'LEVEL',7,C.muted,700),readout('overview-a',22,107,level,'',' %',0,18,C.text,'start',100),
    rect('overview-card-b',114,63,91,61,C.panel2),text('overview-b-label',124,80,'PUMP RPM',7,C.muted,700),readout('overview-b',124,107,rpm,'','',0,18,C.text),
    rect('overview-card-c',216,63,91,61,C.panel2),text('overview-c-label',226,80,'FLOW',7,C.muted,700),readout('overview-c',226,107,flow,'','',2,18,C.cyan),
    line('overview-pipe',28,158,292,158,C.line,8),
    {id:'overview-flow',kind:'flow',points:[{x:28,y:158},{x:292,y:158}],value:{signal:flow},background:C.line,color:C.cyan,width:3,backgroundWidth:8,packetRadius:2.3,packetSpacing:26,speed:56},
    {id:'overview-pump',kind:'pump',cx:160,cy:158,r:23,rpm:{signal:rpm},shell:C.dark,body:C.panel2,bladeA:C.cyan,bladeB:rgb565(40,139,156),hub:C.white},
    {id:'overview-lamp',kind:'lamp',cx:284,cy:158,r:13,value:{signal:load,min:0,max:1},off:rgb565(38,58,66),on:C.green,halo:C.green,highlight:C.white,stroke:C.muted,pulseHz:1.15},
    boolText('overview-do',300,199,sig(controllerId,'DO1'),'DO1 ', 'ON','OFF',8,C.muted,'end'),
    ...footer('> process   DN I/O   UP network'),
  ]};
}
function process(project:Project,controllerId:string,page:PlcShellPage,index:number,total:number):SaturnDisplayScene{
  const pump=byType(project,controllerId,'pump'),tank=byType(project,controllerId,'reservoir'),lamp=byType(project,controllerId,'indicator');
  const level=tank?sig(tank.id,'level'):sig(controllerId,'AI1'),rpm=pump?sig(pump.id,'rpm'):sig(controllerId,'AI1'),flow=pump?sig(pump.id,'flow'):sig(controllerId,'DO1'),load=lamp?sig(lamp.id,'brightness'):sig(controllerId,'DO1');
  return{background:C.bg,nodes:[
    ...header(page,index,total),text('process-mode',12,47,'PROCESS',8,C.cyan,800),
    {id:'tank',kind:'tank',x:18,y:70,width:68,height:100,level:{signal:level,min:0,max:1},shell:C.muted,background:C.dark,water:C.water,waterLine:C.water2,waveAmplitude:2.5,waveLength:23,waveSpeed:.009,radius:8},
    text('tank-name',52,185,tank?.id??'TANK',8,C.muted,700,'middle'),readout('tank-level',52,199,level,'',' %',0,10,C.text,'middle',100),
    {id:'flow-in',kind:'flow',points:[{x:86,y:121},{x:127,y:121}],value:{signal:flow},background:C.line,color:C.cyan,width:4,backgroundWidth:10,packetRadius:2.5,packetSpacing:16,speed:58},
    {id:'pump',kind:'pump',cx:160,cy:121,r:30,rpm:{signal:rpm},shell:C.dark,body:C.panel2,bladeA:C.cyan,bladeB:rgb565(39,138,155),hub:C.white},
    {id:'flow-out',kind:'flow',points:[{x:193,y:121},{x:239,y:121}],value:{signal:flow},background:C.line,color:C.cyan,width:4,backgroundWidth:10,packetRadius:2.5,packetSpacing:17,speed:58},
    text('pump-name',160,174,pump?.id??'PUMP',8,C.muted,700,'middle'),readout('pump-rpm',160,188,rpm,'',' rpm',0,9,C.text,'middle'),
    rect('relay',220,99,27,44,C.panel2,C.muted,5),text('relay-r',233.5,126,'R',11,C.muted,800,'middle'),
    {id:'lamp',kind:'lamp',cx:279,cy:121,r:19,value:{signal:load,min:0,max:1},off:rgb565(38,58,66),on:C.green,halo:C.green,highlight:C.white,stroke:C.muted,pulseHz:1.2},
    text('load-name',279,158,lamp?.id??'LOAD',8,C.muted,700,'middle'),readout('flow-readout',112,203,flow,'FLOW ','',2,8,C.cyan),
    boolText('do-readout',302,203,sig(controllerId,'DO1'),'DO1 ','ON','OFF',8,C.muted,'end'),
    ...footer('< overview   > object   DN I/O'),
  ]};
}
function pumpDetail(page:Extract<PlcShellPage,{kind:'device'}>,controllerId:string,index:number,total:number):SaturnDisplayScene{
  const id=page.deviceId,rpm=sig(id,'rpm'),flow=sig(id,'flow'),power=sig(id,'power'),driver=page.driver?sig(controllerId,page.driver):rpm;
  return{background:C.bg,nodes:[
    ...header(page,index,total),text('pump-kind',12,47,'CENTRIFUGAL PUMP',8,C.cyan,800),
    {id:'pump',kind:'pump',cx:177,cy:119,r:53,rpm:{signal:rpm},shell:C.dark,body:C.panel2,bladeA:C.cyan,bladeB:rgb565(39,138,155),hub:C.white},
    rect('rpm-card',12,69,77,39),text('rpm-label',20,84,'RPM',7,C.muted,700),readout('rpm-value',20,104,rpm,'','',0,15,C.text),
    rect('flow-card',12,115,77,39),text('flow-label',20,130,'FLOW',7,C.muted,700),readout('flow-value',20,150,flow,'','',2,15,C.cyan),
    rect('power-card',12,161,77,35),text('power-label',20,175,'POWER',7,C.muted,700),readout('power-value',20,191,power,'','',2,12,C.text),
    rect('state-card',244,70,62,31,C.panel2,C.line,15),boolText('state-value',275,90,driver,'','RUN','STOP',9,C.green,'middle'),
    {id:'pump-flow',kind:'flow',points:[{x:238,y:131},{x:298,y:131}],value:{signal:flow},background:C.line,color:C.cyan,width:3,backgroundWidth:5,packetRadius:2,packetSpacing:16,speed:60},
    text('pump-ctrl',275,153,page.controlSetpoint?'UP START':'MONITOR',7,C.muted,700,'middle'),text('pump-ctrl2',275,168,page.controlSetpoint?'DN STOP':'< BACK',7,C.muted,700,'middle'),
    ...footer('< process   > next   UP/DN control'),
  ]};
}
function tankDetail(page:Extract<PlcShellPage,{kind:'device'}>,index:number,total:number):SaturnDisplayScene{
  const level=sig(page.deviceId,'level');
  return{background:C.bg,nodes:[
    ...header(page,index,total),text('tank-kind',12,47,'RESERVOIR',8,C.cyan,800),
    {id:'tank',kind:'tank',x:89,y:59,width:142,height:133,level:{signal:level,min:0,max:1},shell:C.muted,background:C.dark,water:C.water,waterLine:C.water2,waveAmplitude:3,waveLength:27,waveSpeed:.008,radius:12},
    rect('level-card',18,82,58,53),text('level-label',47,99,'LEVEL',7,C.muted,700,'middle'),readout('level-value',47,123,level,'',' %',0,17,C.text,'middle',100),
    line('gauge-bg',244,70,244,187,C.line,5),text('g100',286,78,'100',7,C.muted,600,'end',true),text('g50',286,131,'50',7,C.muted,600,'end',true),text('g0',286,188,'0',7,C.muted,600,'end',true),
    ...footer('< process   > next   monitor only'),
  ]};
}
function indicatorDetail(page:Extract<PlcShellPage,{kind:'device'}>,index:number,total:number):SaturnDisplayScene{
  const value=sig(page.deviceId,'brightness');
  return{background:C.bg,nodes:[
    ...header(page,index,total),text('lamp-kind',12,47,'INDICATOR',8,C.cyan,800),
    {id:'lamp',kind:'lamp',cx:160,cy:119,r:54,value:{signal:value,min:0,max:1},off:rgb565(38,58,66),on:C.green,halo:C.green,highlight:C.white,stroke:C.muted,pulseHz:1.25},
    boolText('lamp-state',160,194,value,'','ON','OFF',15,C.green,'middle'),...footer('< process   > next'),
  ]};
}
function genericDetail(project:Project,page:Extract<PlcShellPage,{kind:'device'}>,index:number,total:number):SaturnDisplayScene{
  const device=project.devices.find(d=>d.id===page.deviceId),keys=Object.keys(device?.signals??{}).slice(0,4);
  return{background:C.bg,nodes:[
    ...header(page,index,total),text('generic-kind',12,47,page.visual.toUpperCase(),8,C.cyan,800),
    rect('generic-body',68,67,184,93,C.panel2,C.line,12),{id:'generic-led',kind:'circle',cx:102,cy:113,r:20,fill:C.dark,stroke:C.cyan,strokeWidth:2},{id:'generic-dot',kind:'circle',cx:102,cy:113,r:6,fill:C.cyan},
    text('generic-id',135,102,page.deviceId,12,C.text,800),text('generic-type',135,121,page.visual,8,C.muted,700),
    ...keys.map((key,n)=>readout('generic-'+key,28,180+n*10,sig(page.deviceId,key),key.toUpperCase()+' ','',1,8,n===0?C.cyan:C.muted)),
    ...footer('< process   > next'),
  ]};
}
function ioScene(page:Extract<PlcShellPage,{kind:'io'}>,controllerId:string,index:number,total:number):SaturnDisplayScene{
  const nodes:DisplayNode[]=[...header(page,index,total),text('io-kind',12,47,'LIVE I/O',8,C.cyan,800)];
  page.signals.slice(0,6).forEach((name,n)=>{
    const x=n%2?165:12,y=58+Math.floor(n/2)*46,digital=/^[D][IO]/.test(name),signal=sig(controllerId,name);
    nodes.push(rect('io-card-'+n,x,y,143,37),text('io-label-'+n,x+10,y+15,name,8,C.muted,750));
    nodes.push(digital?boolText('io-value-'+n,x+132,y+25,signal,'','ON','OFF',13,C.text,'end'):readout('io-value-'+n,x+132,y+25,signal,'','',0,13,C.text,'end'));
  });
  nodes.push(...footer('< overview   UP process   > network'));return{background:C.bg,nodes};
}
function networkScene(page:Extract<PlcShellPage,{kind:'network'}>,controllerId:string,index:number,total:number):SaturnDisplayScene{
  const healthy=sig(controllerId,'healthy'),peer=page.peers[0]??'NO PEER';
  return{background:C.bg,nodes:[
    ...header(page,index,total),text('network-kind',12,47,'NETWORK',8,C.cyan,800),
    rect('network-local',16,76,108,64),text('network-local-title',28,95,'SATURN PLC',8,C.muted,750),text('network-local-id',28,119,controllerId,10,C.text,650,'start',true),
    {id:'network-flow',kind:'flow',points:[{x:124,y:108},{x:194,y:108}],value:{signal:healthy,fallback:1},background:C.line,color:C.cyan,width:2,backgroundWidth:4,packetRadius:2.6,packetSpacing:18,speed:52,threshold:.1},
    rect('network-peer',194,76,110,64),text('network-peer-title',206,95,page.peers.length?'PEER':'BUS',8,C.muted,750),text('network-peer-id',206,119,peer,9,page.peers.length?C.text:C.muted,650,'start',true),
    rect('network-health',16,157,288,34,C.panel2,C.line,7),boolText('network-health-value',28,178,healthy,'LINK / RUNTIME ','HEALTHY','DEGRADED',9,C.green),
    ...footer('< overview   UP process   DN I/O'),
  ]};
}

function compactHeader(title:string,index:number,total:number):DisplayNode[]{
  return[
    rect('c-head',0,0,320,18,rgb565(7,24,31),rgb565(7,24,31),0),
    line('c-head-rule',0,18,320,18,rgb565(29,66,78),1),
    {id:'c-live',kind:'circle',cx:9,cy:9,r:3,fill:C.green},
    text('c-title',17,12,title,8,C.text,750),
    text('c-count',310,12,`${index+1}/${total}`,7,C.muted,600,'end',true),
  ];
}
function compactFooter(hint:string):DisplayNode[]{
  return[
    rect('c-foot',0,224,320,16,rgb565(7,24,31),rgb565(7,24,31),0),
    line('c-foot-rule',0,224,320,224,rgb565(29,66,78),1),
    text('c-hint',10,236,hint,7,C.muted,600,'start',true),
  ];
}
function compactOverview(project:Project,controllerId:string,page:PlcShellPage,index:number,total:number):SaturnDisplayScene{
  const pump=byType(project,controllerId,'pump'),tank=byType(project,controllerId,'reservoir'),filter=byType(project,controllerId,'filter'),valve=byType(project,controllerId,'valve'),acc=byType(project,controllerId,'accumulator');
  const level=tank?sig(tank.id,'level'):sig(controllerId,'AI1'),rpm=pump?sig(pump.id,'rpm'):sig(controllerId,'DO1'),flow=pump?sig(pump.id,'flow'):sig(controllerId,'DO1');
  const fouling=filter?sig(filter.id,'fouling'):sig(controllerId,'AI2'),opening=valve?sig(valve.id,'opening'):sig(controllerId,'DO2'),pressure=acc?sig(acc.id,'pressure'):sig(controllerId,'AI2'),accLevel=acc?sig(acc.id,'level'):sig(controllerId,'AI2');
  const nodes:DisplayNode[]=[
    ...compactHeader(page.title,index,total),
    text('c-mode',9,31,'LIVE PROCESS',7,C.cyan,800),
    {id:'tank',kind:'tank',x:10,y:43,width:51,height:92,level:{signal:level,scale:.01,min:0,max:1},shell:C.muted,background:C.dark,water:C.water,waterLine:C.water2,waveAmplitude:2,waveLength:18,waveSpeed:.01,radius:7},
    text('c-tank',35.5,146,tank?.id??'TANK',7,C.muted,700,'middle'),
    {id:'flow-a',kind:'flow',points:[{x:61,y:91},{x:88,y:91}],value:{signal:flow},background:C.line,color:C.cyan,width:3,backgroundWidth:7,packetRadius:2,packetSpacing:12,speed:60},
    {id:'pump',kind:'pump',cx:113,cy:91,r:23,rpm:{signal:rpm},shell:C.dark,body:C.panel2,bladeA:C.cyan,bladeB:rgb565(38,137,154),hub:C.white},
    text('c-pump',113,128,pump?.id??'PUMP',7,C.muted,700,'middle'),
    {id:'flow-b',kind:'flow',points:[{x:139,y:91},{x:155,y:91}],value:{signal:flow},background:C.line,color:C.cyan,width:3,backgroundWidth:7,packetRadius:2,packetSpacing:11,speed:60},
    rect('c-filter-box',155,72,34,38,C.panel2,C.muted,5),text('c-filter-f',172,88,'F',11,C.cyan,800,'middle'),
    readout('c-fouling',172,103,fouling,'','%',0,7,C.muted,'middle'),
    {id:'flow-c',kind:'flow',points:[{x:189,y:91},{x:207,y:91}],value:{signal:flow},background:C.line,color:C.cyan,width:3,backgroundWidth:7,packetRadius:2,packetSpacing:11,speed:60},
    {id:'c-valve-ring',kind:'circle',cx:222,cy:91,r:14,fill:C.dark,stroke:C.cyan,strokeWidth:2},
    line('c-valve-blade',212,101,232,81,C.cyan,3),readout('c-opening',222,119,opening,'','%',0,7,C.muted,'middle'),
    {id:'flow-d',kind:'flow',points:[{x:237,y:91},{x:258,y:91}],value:{signal:flow},background:C.line,color:C.cyan,width:3,backgroundWidth:7,packetRadius:2,packetSpacing:11,speed:60},
    {id:'acc',kind:'tank',x:260,y:43,width:49,height:92,level:{signal:accLevel,scale:.01,min:0,max:1},shell:C.muted,background:C.dark,water:rgb565(29,121,159),waterLine:C.cyan,waveAmplitude:1.5,waveLength:18,waveSpeed:.007,radius:10},
    text('c-acc',284.5,146,acc?.id??'ACC',7,C.muted,700,'middle'),
    rect('kpi-a',8,158,96,55,C.panel2,C.line,6),text('kpi-a-l',16,172,'LEVEL',6,C.muted,700),readout('kpi-a-v',16,197,level,'','%',0,18,C.text),
    rect('kpi-b',112,158,96,55,C.panel2,C.line,6),text('kpi-b-l',120,172,'PUMP',6,C.muted,700),readout('kpi-b-v',120,197,rpm,'','',0,18,C.text),text('kpi-b-u',194,205,'rpm',6,C.muted,600,'end'),
    rect('kpi-c',216,158,96,55,C.panel2,C.line,6),text('kpi-c-l',224,172,'PRESSURE',6,C.muted,700),readout('kpi-c-v',224,197,pressure,'','',2,18,C.cyan),
    ...compactFooter('< home   > equipment   UP net   DN diag'),
  ];
  return{background:C.bg,nodes};
}
function compactDevice(project:Project,controllerId:string,page:Extract<PlcShellPage,{kind:'device'}>,index:number,total:number):SaturnDisplayScene{
  const id=page.deviceId,visual=page.visual;
  const nodes:DisplayNode[]=[...compactHeader(id,index,total)];
  if(visual==='pump'||visual==='motor'||visual==='fan'){
    const rpm=sig(id,'rpm'),flow=sig(id,visual==='pump'?'flow':visual==='fan'?'airflow':'speed'),power=sig(id,visual==='pump'?'power':'load');
    nodes.push(
      {id:'pump',kind:'pump',cx:91,cy:112,r:54,rpm:{signal:rpm},shell:C.dark,body:C.panel2,bladeA:C.cyan,bladeB:rgb565(38,137,154),hub:C.white},
      text('d-machine',91,187,visual.toUpperCase(),7,C.muted,700,'middle'),
      rect('d-rpm',169,36,137,45,C.panel2),text('d-rpm-l',178,50,'RPM',6,C.muted,700),readout('d-rpm-v',178,72,rpm,'','',0,17,C.text),
      rect('d-flow',169,88,137,45,C.panel2),text('d-flow-l',178,102,visual==='pump'?'FLOW':'LOAD',6,C.muted,700),readout('d-flow-v',178,124,flow,'','',2,17,C.cyan),
      rect('d-power',169,140,137,45,C.panel2),text('d-power-l',178,154,'POWER',6,C.muted,700),readout('d-power-v',178,176,power,'','',2,17,C.text),
      page.controlSetpoint?boolText('d-state',306,211,sig(controllerId,page.driver??'DO1'),'','RUN','STOP',8,C.green,'end'):text('d-monitor',306,211,'MONITOR',8,C.muted,700,'end',true),
    );
  } else if(visual==='reservoir'||visual==='accumulator'){
    const level=sig(id,'level'),pressure=visual==='accumulator'?sig(id,'pressure'):sig(id,'flow');
    nodes.push(
      {id:'tank',kind:'tank',x:28,y:32,width:121,height:174,level:{signal:level,scale:.01,min:0,max:1},shell:C.muted,background:C.dark,water:C.water,waterLine:C.water2,waveAmplitude:3,waveLength:25,waveSpeed:.008,radius:12},
      rect('d-level',169,48,137,58,C.panel2),text('d-level-l',180,64,'LEVEL',6,C.muted,700),readout('d-level-v',180,94,level,'','%',0,22,C.text),
      rect('d-second',169,116,137,58,C.panel2),text('d-second-l',180,132,visual==='accumulator'?'PRESSURE':'FLOW',6,C.muted,700),readout('d-second-v',180,162,pressure,'','',2,22,C.cyan),
      text('d-vessel',237,201,visual.toUpperCase(),7,C.muted,700,'middle'),
    );
  } else if(visual==='valve'){
    const opening=sig(id,'opening'),flow=sig(id,'flow');
    nodes.push(
      {id:'v-ring',kind:'circle',cx:100,cy:108,r:57,fill:C.dark,stroke:C.cyan,strokeWidth:3},
      line('v-blade',61,147,139,69,C.cyan,7),{id:'v-hub',kind:'circle',cx:100,cy:108,r:8,fill:C.white},
      rect('v-open',177,52,129,55,C.panel2),text('v-open-l',187,68,'OPENING',6,C.muted,700),readout('v-open-v',187,96,opening,'','%',0,21,C.text),
      rect('v-flow',177,119,129,55,C.panel2),text('v-flow-l',187,135,'FLOW',6,C.muted,700),readout('v-flow-v',187,163,flow,'','',2,21,C.cyan),
      page.controlSetpoint?boolText('v-cmd',306,207,sig(controllerId,page.driver??'DO2'),'CMD ','OPEN','CLOSE',8,C.green,'end'):text('v-mon',306,207,'MONITOR',8,C.muted,700,'end',true),
    );
  } else if(visual==='filter'){
    const fouling=sig(id,'fouling'),dp=sig(id,'pressureDrop'),res=sig(id,'resistance');
    nodes.push(
      rect('f-body',35,47,122,135,C.panel2,C.muted,14),
      line('f-grid1',55,65,137,164,C.line,3),line('f-grid2',75,57,151,150,C.line,3),line('f-grid3',43,94,112,178,C.line,3),
      text('f-title',96,204,'STRAINER',7,C.muted,700,'middle'),
      rect('f-a',177,45,129,47,C.panel2),text('f-a-l',187,60,'FOULING',6,C.muted,700),readout('f-a-v',187,84,fouling,'','%',0,18,fouling?C.amber:C.text),
      rect('f-b',177,101,129,47,C.panel2),text('f-b-l',187,116,'DELTA P',6,C.muted,700),readout('f-b-v',187,140,dp,'','',2,18,C.cyan),
      rect('f-c',177,157,129,47,C.panel2),text('f-c-l',187,172,'RESISTANCE',6,C.muted,700),readout('f-c-v',187,196,res,'','',2,18,C.text),
    );
  } else {
    nodes.push(...genericDetail(project,page,index,total).nodes.filter(n=>!String(n.id??'').startsWith('header')&&!String(n.id??'').startsWith('footer')));
  }
  nodes.push(...compactFooter(page.controlSetpoint?'< home   > next   UP start/open   DN stop/close':'< home   > next'));
  return{background:C.bg,nodes};
}
function compactIo(page:Extract<PlcShellPage,{kind:'io'}>,controllerId:string,index:number,total:number):SaturnDisplayScene{
  const nodes:DisplayNode[]=[...compactHeader('I/O DIAGNOSTICS',index,total)];
  page.signals.slice(0,8).forEach((name,n)=>{
    const col=n%2,row=Math.floor(n/2),x=8+col*156,y=28+row*45,digital=/^[D][IO]/.test(name),signal=sig(controllerId,name);
    nodes.push(rect('cio-'+n,x,y,148,37,C.panel2,C.line,6),text('cio-l-'+n,x+9,y+14,name,7,C.muted,700));
    nodes.push(digital?boolText('cio-v-'+n,x+137,y+26,signal,'','ON','OFF',12,C.text,'end'):readout('cio-v-'+n,x+137,y+26,signal,'','',0,12,C.text,'end'));
  });
  nodes.push(...compactFooter('< home   > network   UP home'));return{background:C.bg,nodes};
}
function compactNetwork(page:Extract<PlcShellPage,{kind:'network'}>,controllerId:string,index:number,total:number):SaturnDisplayScene{
  const healthy=sig(controllerId,'healthy'),peer=page.peers[0]??'NO MODULE';
  return{background:C.bg,nodes:[
    ...compactHeader('NETWORK',index,total),
    rect('cn-plc',18,58,112,72,C.panel2,C.green,9),text('cn-plc-t',30,77,'SATURN PLC',7,C.muted,750),text('cn-plc-id',30,102,controllerId,10,C.text,700,'start',true),
    {id:'cn-link',kind:'flow',points:[{x:130,y:94},{x:190,y:94}],value:{signal:healthy,fallback:1},background:C.line,color:C.cyan,width:2,backgroundWidth:5,packetRadius:2.5,packetSpacing:16,speed:48,threshold:.1},
    rect('cn-peer',190,58,112,72,C.panel2,page.peers.length?C.cyan:C.line,9),text('cn-peer-t',202,77,'EXPANSION',7,C.muted,750),text('cn-peer-id',202,102,peer,9,page.peers.length?C.text:C.muted,650,'start',true),
    rect('cn-health',18,150,284,52,C.panel2,C.line,7),text('cn-health-l',30,168,'BUS / RUNTIME',6,C.muted,700),boolText('cn-health-v',30,191,healthy,'','HEALTHY','DEGRADED',14,C.green),
    ...compactFooter('< home   > home   DN diagnostics'),
  ]};
}
function compactSceneFor(project:Project,controllerId:string,page:PlcShellPage,index:number,total:number):SaturnDisplayScene{
  if(page.kind==='overview')return compactOverview(project,controllerId,page,index,total);
  if(page.kind==='device')return compactDevice(project,controllerId,page,index,total);
  if(page.kind==='io')return compactIo(page,controllerId,index,total);
  if(page.kind==='network')return compactNetwork(page,controllerId,index,total);
  return compactOverview(project,controllerId,page,index,total);
}

function sceneFor(project:Project,controllerId:string,page:PlcShellPage,index:number,total:number):SaturnDisplayScene{
  if(page.kind==='overview')return overview(project as Project,{} as Frame,controllerId,page,index,total);
  if(page.kind==='process')return process(project,controllerId,page,index,total);
  if(page.kind==='io')return ioScene(page,controllerId,index,total);
  if(page.kind==='network')return networkScene(page,controllerId,index,total);
  if(page.visual==='pump'||page.visual==='motor'||page.visual==='fan')return pumpDetail(page,controllerId,index,total);
  if(page.visual==='reservoir')return tankDetail(page,index,total);
  if(page.visual==='indicator')return indicatorDetail(page,index,total);
  return genericDetail(project,page,index,total);
}
function signalsFor(frame:Frame):DisplaySignals{
  return Object.fromEntries(Object.entries(frame.samples).map(([id,sample])=>[id,sample.quality==='good'&&typeof sample.value==='number'?sample.value:null]));
}
const SVG_NS='http://www.w3.org/2000/svg';
const emulators=new WeakMap<SVGSVGElement,SaturnDisplayEmulator>();
function svgElement(name:string,attributes:Record<string,string|number|undefined>):SVGElement{
  const element=document.createElementNS(SVG_NS,name);
  for(const [key,value] of Object.entries(attributes))if(value!==undefined)element.setAttribute(key,String(value));
  return element;
}
function appendCommand(group:SVGGElement,command:DisplayDrawCommand,index:number):void{
  const common={'data-firmverse-command':command.type,'data-source':command.source??'','data-index':index};
  let node:SVGElement;
  if(command.type==='rect')node=svgElement('rect',{...common,x:command.x,y:command.y,width:command.width,height:command.height,rx:command.radius??0,fill:css565(command.fill),stroke:command.stroke===undefined?'none':css565(command.stroke),'stroke-width':command.strokeWidth??0,opacity:command.opacity??1});
  else if(command.type==='circle')node=svgElement('circle',{...common,cx:command.cx,cy:command.cy,r:command.r,fill:css565(command.fill),stroke:command.stroke===undefined?'none':css565(command.stroke),'stroke-width':command.strokeWidth??0,opacity:command.opacity??1});
  else if(command.type==='line')node=svgElement('line',{...common,x1:command.x1,y1:command.y1,x2:command.x2,y2:command.y2,stroke:css565(command.color),'stroke-width':command.width,'stroke-linecap':'round',opacity:command.opacity??1});
  else if(command.type==='polyline')node=svgElement('polyline',{...common,points:command.points.map(p=>`${p.x},${p.y}`).join(' '),fill:'none',stroke:css565(command.color),'stroke-width':command.width,'stroke-linecap':'round','stroke-linejoin':'round',opacity:command.opacity??1});
  else if(command.type==='polygon')node=svgElement('polygon',{...common,points:command.points.map(p=>`${p.x},${p.y}`).join(' '),fill:css565(command.fill),opacity:command.opacity??1});
  else {
    node=svgElement('text',{...common,x:command.x,y:command.y,fill:css565(command.color),'font-size':command.size,'font-weight':command.weight,'text-anchor':command.align,'font-family':command.mono?'ui-monospace,SFMono-Regular,Menlo,monospace':'Inter,system-ui,sans-serif','dominant-baseline':'alphabetic'});
    node.textContent=command.text;
  }
  group.append(node);
}

/**
 * Thin browser projector for the saturn-plc-320 target.
 * Firmverse owns model-time animation; this function only maps the returned
 * vector frame to SVG and owns no HMI/runtime state.
 */
export function drawSaturnPlcTargetSvg(svg:SVGSVGElement,project:Project,frame:Frame,controllerId:string):void{
  let emulator=emulators.get(svg);
  if(!emulator){emulator=new SaturnDisplayEmulator();emulators.set(svg,emulator);}
  const model=generatePlcShell(project,controllerId);
  const index=frame.controllerScreens?.[controllerId]??0;
  const page=shellPage(model,index);
  const compact=controller(project,controllerId)?.hmi.shell?.mode==='compact';
  let scene=compact?compactSceneFor(project,controllerId,page,index,model.pages.length):sceneFor(project,controllerId,page,index,model.pages.length);
  if(!compact&&page.kind==='overview')scene=overview(project,frame,controllerId,page,index,model.pages.length);
  const display=emulator.render(scene,signalsFor(frame),frame.time);
  svg.setAttribute('viewBox','0 0 320 240');
  svg.replaceChildren();
  const group=svgElement('g',{
    'data-firmverse-display':'true',
    'data-controller-id':controllerId,
    'data-hmi-page':page.id,
    'data-display-time':String(display.timeMs),
  }) as SVGGElement;
  display.commands.forEach((command,i)=>appendCommand(group,command,i));
  svg.append(group);
}
