import type { HmiDrawCommand } from './vendor/saturn/src/runtime';
let displays:Record<string,HmiDrawCommand[]>={};
export const setDisplays=(value:Record<string,HmiDrawCommand[]>)=>{displays=value;};
export const getDisplay=(id:string)=>displays[id]??[];
export const color565=(c:number)=>`rgb(${Math.round((c>>11&31)*255/31)},${Math.round((c>>5&63)*255/63)},${Math.round((c&31)*255/31)})`;
const keys=new WeakMap<SVGSVGElement,string>();
export function drawHmiSvg(svg:SVGSVGElement,id:string){const commands=getDisplay(id),key=JSON.stringify(commands);if(keys.get(svg)===key)return;keys.set(svg,key);svg.replaceChildren();
 const el=(tag:string,attrs:Record<string,string|number>,text?:string)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;svg.append(n);};
 if(!commands.length)el('text',{x:12,y:40,fill:'#a1b7c4','font-size':14},'Нет питания / качество входов');
 for(const c of commands){if(c.type==='text')el('text',{x:c.x,y:c.y+14,fill:color565(c.color),'font-size':c.font===1?16:13,'font-family':'monospace'},c.text);
 else if(c.type==='rect')el('rect',{x:c.x1,y:c.y1,width:c.x2-c.x1+1,height:c.y2-c.y1+1,fill:color565(c.color)});
 else if(c.type==='line')el('line',{x1:c.x1,y1:c.y1,x2:c.x2,y2:c.y2,stroke:color565(c.color)});
 else if(c.type==='ellipse')el('ellipse',{cx:(c.x1+c.x2)/2,cy:(c.y1+c.y2)/2,rx:Math.abs(c.x2-c.x1)/2,ry:Math.abs(c.y2-c.y1)/2,fill:color565(c.color)});}
}
export function drawHmiCanvas(canvas:HTMLCanvasElement,id:string){const ctx=canvas.getContext('2d');if(!ctx)return;ctx.fillStyle='#10212c';ctx.fillRect(0,0,320,240);for(const c of getDisplay(id)){
 if(c.type==='image')continue;ctx.fillStyle=color565(c.color);ctx.strokeStyle=ctx.fillStyle;
 if(c.type==='text'){ctx.font=`${c.font===1?16:13}px monospace`;ctx.fillText(c.text,c.x,c.y+14);}
 else if(c.type==='rect')ctx.fillRect(c.x1,c.y1,c.x2-c.x1+1,c.y2-c.y1+1);
 else if(c.type==='line'){ctx.beginPath();ctx.moveTo(c.x1,c.y1);ctx.lineTo(c.x2,c.y2);ctx.stroke();}
 else{ctx.beginPath();ctx.ellipse((c.x1+c.x2)/2,(c.y1+c.y2)/2,Math.abs(c.x2-c.x1)/2,Math.abs(c.y2-c.y1)/2,0,0,Math.PI*2);ctx.fill();}}
}
