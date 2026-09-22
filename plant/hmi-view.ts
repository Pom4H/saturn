import type { SaturnHmiCommand, SaturnHmiFrame } from './hmi-frame';
import { renderHmiReact, renderHmiReactCanvas } from './hmi-react';

let displays:Record<string,SaturnHmiFrame>={};
export const setDisplays=(value:Record<string,SaturnHmiCommand[]>,timeMs=0)=>{
  displays=Object.fromEntries(Object.entries(value).map(([id,commands])=>[id,{width:320,height:240,timeMs,commands}]));
};
export const getDisplay=(id:string):SaturnHmiFrame=>displays[id]??{width:320,height:240,timeMs:0,commands:[]};
export function drawHmiSvg(svg:SVGSVGElement,id:string){renderHmiReact(svg,getDisplay(id));}
export function drawHmiCanvas(canvas:HTMLCanvasElement,id:string,onRendered?:()=>void){renderHmiReactCanvas(canvas,getDisplay(id),onRendered);}
