import { ControllerVM, type Controller } from '../controller';
import { renderHmiReact } from '../hmi-react';
import { renderSaturnPlcSvg } from '../saturn-view';

declare global { interface Window { __saturnHmiVideoReady?: boolean } }

const controller:Controller={
  id:'SATURN-1',
  profile:'saturn-fbd',
  system:'commissioning',
  layout:{x:0,y:0},
  outputs:{DO1:{op:'gt',args:[{ref:'AI1'},500]}},
  hmi:{
    title:'Commissioning bench',
    rows:[{label:'AI1 x100',pin:'AI1'},{label:'Relay DO1',pin:'DO1'}],
    scene:{width:320,height:240,background:0x0024,nodes:[
      {id:'title',kind:'text',x:12,y:10,text:'SATURN · PUMP LOOP',color:0xffff,size:14,weight:700},
      {id:'tank',kind:'tank',x:14,y:52,width:58,height:128,level:{signal:'AI1',scale:.001,min:0,max:1},shell:0xbdf7,background:0x0841,water:0x05ff,waterLine:0x07ff},
      {id:'flow',kind:'flow',points:[{x:72,y:116},{x:120,y:116},{x:145,y:132}],value:{signal:'DO1'},background:0x2104,color:0x07ff,width:4,packetSpacing:18,speed:42},
      {id:'pump',kind:'pump',cx:188,cy:132,r:31,rpm:{signal:'DO1',scale:420},shell:0x0841,body:0x2104,bladeA:0x07ff,bladeB:0x04b2,hub:0xffff,bladeCount:6},
      {id:'lamp',kind:'lamp',cx:278,cy:60,r:15,value:{signal:'DO1'},off:0x2104,on:0x07e0,halo:0x07e0,highlight:0xffff},
      {id:'input',kind:'text',x:92,y:196,text:{value:{signal:'AI1'},prefix:'AI1 ',digits:0},color:0xffff,size:12,weight:700,mono:true},
      {id:'output',kind:'text',x:210,y:196,text:{value:{signal:'DO1'},prefix:'DO1 ',digits:0,on:'ON',off:'OFF'},color:0xffff,size:12,weight:700,mono:true}
    ]}
  }
};

const host=document.querySelector<HTMLElement>('#plc-front')!;
host.innerHTML=renderSaturnPlcSvg({defsPrefix:'video'});
const screen=host.querySelector<SVGSVGElement>('.runtime-hmi')!;
const ai=document.querySelector<HTMLElement>('#ai')!;
const output=document.querySelector<HTMLElement>('#do')!;
const modelTime=document.querySelector<HTMLElement>('#model-time')!;
const vm=new ControllerVM(controller);
let timeMs=0;

function inputAt(t:number):number {
  if(t<1500)return 300;
  if(t<3200)return Math.round(300+(t-1500)/1700*500);
  return 800;
}
function tick(){
  timeMs+=50;
  const input=inputAt(timeMs);
  const result=vm.scan({AI1:input},50,timeMs);
  renderHmiReact(screen,{width:320,height:240,timeMs,commands:result.hmi});
  ai.textContent=String(input);
  output.textContent=String(result.outputs.DO1);
  modelTime.textContent=(timeMs/1000).toFixed(2)+' s';
}
tick();
setInterval(tick,50);
window.__saturnHmiVideoReady=true;
