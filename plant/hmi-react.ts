import React from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SaturnHmiCommand, SaturnHmiFrame } from './hmi-frame';

export const color565=(c:number)=>`rgb(${Math.round((c>>11&31)*255/31)},${Math.round((c>>5&63)*255/63)},${Math.round((c&31)*255/31)})`;

const sourceProps=(command:SaturnHmiCommand)=>command.source?{'data-source':command.source}:{};
const points=(value:{x:number;y:number}[])=>value.map(point=>`${point.x},${point.y}`).join(' ');

function commandElement(command:SaturnHmiCommand,index:number):unknown {
  const common={key:index,...sourceProps(command),opacity:command.opacity};
  switch(command.type){
    case'rect':return React.createElement('rect',{...common,x:command.x,y:command.y,width:command.width,height:command.height,rx:command.radius,fill:color565(command.fill),stroke:command.stroke===undefined?undefined:color565(command.stroke),strokeWidth:command.strokeWidth});
    case'circle':return React.createElement('circle',{...common,cx:command.cx,cy:command.cy,r:command.r,fill:color565(command.fill),stroke:command.stroke===undefined?undefined:color565(command.stroke),strokeWidth:command.strokeWidth});
    case'line':return React.createElement('line',{...common,x1:command.x1,y1:command.y1,x2:command.x2,y2:command.y2,stroke:color565(command.color),strokeWidth:command.width,strokeLinecap:'round'});
    case'polyline':return React.createElement('polyline',{...common,points:points(command.points),fill:'none',stroke:color565(command.color),strokeWidth:command.width,strokeLinecap:'round',strokeLinejoin:'round'});
    case'polygon':return React.createElement('polygon',{...common,points:points(command.points),fill:color565(command.fill)});
    case'text':return React.createElement('text',{...common,x:command.x,y:command.y,fill:color565(command.color),fontSize:command.size,fontWeight:command.weight,textAnchor:command.align==='start'?'start':command.align==='middle'?'middle':'end',fontFamily:command.mono?'ui-monospace, SFMono-Regular, Menlo, monospace':'Inter, ui-sans-serif, system-ui, sans-serif',dominantBaseline:'hanging'},command.text);
  }
}

export function SaturnHmi320(props:Record<string,unknown>):unknown {
  const frame=props.frame as SaturnHmiFrame;
  return React.createElement(React.Fragment,null,...frame.commands.map(commandElement));
}

const roots=new WeakMap<SVGSVGElement,ReturnType<typeof createRoot>>();
export function renderHmiReact(svg:SVGSVGElement,frame:SaturnHmiFrame):void {
  svg.setAttribute('viewBox','0 0 320 240');
  svg.setAttribute('data-time-ms',String(frame.timeMs));
  let root=roots.get(svg);if(!root){root=createRoot(svg);roots.set(svg,root);}
  root.render(React.createElement(SaturnHmi320,{frame}));
}

export function hmiSvgMarkup(frame:SaturnHmiFrame):string {
  return renderToStaticMarkup(React.createElement('svg',{xmlns:'http://www.w3.org/2000/svg',viewBox:'0 0 320 240',width:320,height:240,'data-time-ms':frame.timeMs},React.createElement(SaturnHmi320,{frame})));
}

const canvasKeys=new WeakMap<HTMLCanvasElement,string>();
export function renderHmiReactCanvas(canvas:HTMLCanvasElement,frame:SaturnHmiFrame):void {
  const key=JSON.stringify(frame);if(canvasKeys.get(canvas)===key)return;canvasKeys.set(canvas,key);
  const image=new Image();
  image.onload=()=>{const context=canvas.getContext('2d');if(!context)return;context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);};
  image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(hmiSvgMarkup(frame));
}
