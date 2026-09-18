import type { Project, Expr, Device, Simulation } from './types';
import { panel, label, readout, commandButton, navigate, animate, view, screen } from './dsl';
import type { Presentation } from './presentation';
import type { Controller } from './controller';

const safe=(value:string)=>value.replace(/[^A-Za-z0-9_.-]/g,'_').slice(0,90);
const source=<T extends object>(node:T,query:string)=>Object.assign(node,{sourceHint:query});
const push=<T>(map:Map<string,T[]>,key:string,value:T)=>{const list=map.get(key);if(list)list.push(value);else map.set(key,[value]);};

interface TopologyIndex {
    systemById:Map<string,Project['systems'][number]>;
    children:Map<string,Project['systems']>;
    devices:Map<string,Device[]>;
    controls:Map<string,NonNullable<Project['controls']>>;
    deviceById:Map<string,Device>;
    simulationById:Map<string,Simulation>;
    controllerById:Map<string,Controller>;
    overviewByDevice:Map<string,string[]>;
}
function indexTopology(p:Project):TopologyIndex {
    const systemById=new Map(p.systems.map(s=>[s.id,s]));
    const children=new Map<string,Project['systems']>(),devices=new Map<string,Device[]>(),controls=new Map<string,NonNullable<Project['controls']>>();
    for(const system of p.systems)if(system.parent)push(children,system.parent,system);
    for(const device of p.devices)push(devices,device.system,device);
    for(const control of p.controls??[])push(controls,control.system,control);
    const overviewByDevice=new Map<string,string[]>();
    for(const metric of p.overview??[]){const dot=metric.signal.indexOf('.');if(dot>0)push(overviewByDevice,metric.signal.slice(0,dot),metric.signal.slice(dot+1));}
    return {
        systemById,children,devices,controls,
        deviceById:new Map(p.devices.map(x=>[x.id,x])),
        simulationById:new Map(p.simulations.map(x=>[x.id,x])),
        controllerById:new Map((p.controllers??[]).map(x=>[x.id,x])),
        overviewByDevice,
    };
}
function signalEntries(index:TopologyIndex,device:string):[string,Expr][] {
    const d=index.deviceById.get(device);if(d&&Object.keys(d.signals).length)return Object.entries(d.signals);
    if(index.simulationById.has(device))return (index.overviewByDevice.get(device)??[]).map(name=>[name,{ref:device+'.'+name}]);
    const plc=index.controllerById.get(device);
    return plc?[...Object.keys(plc.outputs),...'AI1 AI2 DI1 DI2 healthy powered'.split(' ')].slice(0,8).map(name=>[name,{ref:device+'.'+name}]):[];
}
export interface AutoHmiOptions { root?:string; title?:string; maxSignalsPerDevice?:number }
/** Deterministic HMI projection. Navigation, widgets and commands are derived from the compiled topology; no second project model is stored. */
export function deriveHmi(p:Project,options:AutoHmiOptions={}):Presentation {
    const index=indexTopology(p),root=options.root??p.systems.find(s=>!s.parent)?.id??p.systems[0].id;
    const systems=p.systems.filter(s=>{let id:string|undefined=s.id;while(id){if(id===root)return true;id=index.systemById.get(id)?.parent;}return false;});
    const visible=new Set(systems.map(s=>s.id)),bindings:Record<string,Expr>={};
    const screens=systems.map(sys=>{
        const parent=sys.parent&&visible.has(sys.parent)?sys.parent:undefined,children=(index.children.get(sys.id)??[]).filter(s=>visible.has(s.id));
        const nav=[
            ...(parent?[source(navigate('← '+(index.systemById.get(parent)?.title??'Назад'),parent),`'${parent}'`)]:[]),
            ...children.map(c=>source(navigate(c.title+' →',c.id),`'${c.id}'`)),
        ];
        const deviceWidgets=(index.devices.get(sys.id)??[]).slice(0,24).map(device=>{
            const values=signalEntries(index,device.id).slice(0,options.maxSignalsPerDevice??4).map(([name,expr],i)=>{
                const binding=safe(device.id+'_'+name);bindings[binding]=expr;
                const widget=source(readout(name,binding,'',2),`'${device.id}'`);
                return i===0?source(animate(widget,binding,'opacity',{min:0,max:1,from:.55,to:1}),`'${device.id}'`):widget;
            });
            return source(panel(values.length?values:[label(device.type)],'column',device.id),`'${device.id}'`);
        });
        const commands=(index.controls.get(sys.id)??[]).slice(0,12).flatMap(c=>[
            source(commandButton(c.title+' · min',c.id,c.min),`'${c.id}'`),
            source(commandButton(c.title+' · max',c.id,c.max),`'${c.id}'`),
        ]);
        return screen(sys.id,sys.title,panel([
            source(label(sys.title),`'${sys.id}'`),
            ...(nav.length?[panel(nav,'row','Навигация')]:[]),
            ...(deviceWidgets.length?[panel(deviceWidgets,'row','Оборудование')]:[label('Нет оборудования непосредственно в этой группе')]),
            ...(commands.length?[panel(commands,'row','Управление')]:[]),
        ]));
    });
    const first=screens.find(s=>s.id===root)??screens[0];
    return view('auto-hmi',{title:options.title??p.title,bindings,body:first.body,screens,initial:first.id});
}
