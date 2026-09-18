import type { Project, Expr } from './types';
import { panel, label, readout, commandButton, navigate, animate, view, screen } from './dsl';
import type { Presentation } from './presentation';

const safe=(value:string)=>value.replace(/[^A-Za-z0-9_.-]/g,'_').slice(0,90);
const signalEntries=(p:Project,device:string):[string,Expr][]=>{
    const d=p.devices.find(x=>x.id===device);if(d&&Object.keys(d.signals).length)return Object.entries(d.signals);
    const sim=p.simulations.find(x=>x.id===device);
    if(sim){
        // Runtime signals use model output names; device.signals is the semantic public surface when present.
        const known=p.overview?.filter(x=>x.signal.startsWith(device+'.')).map(x=>x.signal.slice(device.length+1))??[];
        return known.map(name=>[name,{ref:device+'.'+name}]);
    }
    const plc=p.controllers?.find(x=>x.id===device);
    if(plc)return [...Object.keys(plc.outputs),...'AI1 AI2 DI1 DI2 healthy powered'.split(' ')].slice(0,8).map(name=>[name,{ref:device+'.'+name}]);
    return [];
};
export interface AutoHmiOptions { root?:string; title?:string; maxSignalsPerDevice?:number }
/** Deterministic HMI projection. It derives navigation and widgets from the compiled topology; no second model is stored. */
export function deriveHmi(p:Project,options:AutoHmiOptions={}):Presentation {
    const root=options.root??p.systems.find(s=>!s.parent)?.id??p.systems[0].id;
    const descendants=(id:string)=>p.systems.filter(s=>s.parent===id);
    const systems=p.systems.filter(s=>{
        let x:string|undefined=s.id;while(x){if(x===root)return true;x=p.systems.find(k=>k.id===x)?.parent;}return false;
    });
    const bindings:Record<string,Expr>={};
    const screens=systems.map(sys=>{
        const children=descendants(sys.id),parent=sys.parent&&systems.some(x=>x.id===sys.parent)?sys.parent:undefined;
        const devices=p.devices.filter(d=>d.system===sys.id);
        const controls=(p.controls??[]).filter(c=>c.system===sys.id);
        const nav=[
            ...(parent?[navigate('← '+(p.systems.find(x=>x.id===parent)?.title??'Назад'),parent)]:[]),
            ...children.map(c=>navigate(c.title+' →',c.id)),
        ];
        const deviceWidgets=devices.slice(0,24).map(device=>{
            const entries=signalEntries(p,device.id).slice(0,options.maxSignalsPerDevice??4);
            const values=entries.map(([name,expr],i)=>{
                const binding=safe(device.id+'_'+name);bindings[binding]=expr;
                const widget=readout(name,binding,'',2);
                return i===0?animate(widget,binding,'opacity',{min:0,max:1,from:.55,to:1}):widget;
            });
            return panel(values.length?values:[label(device.type)],'column',device.id);
        });
        const commands=controls.slice(0,12).flatMap(c=>[
            commandButton(c.title+' · min',c.id,c.min),
            commandButton(c.title+' · max',c.id,c.max),
        ]);
        return screen(sys.id,sys.title,panel([
            label(sys.title),
            ...(nav.length?[panel(nav,'row','Навигация')]:[]),
            ...(deviceWidgets.length?[panel(deviceWidgets,'row','Оборудование')]:[label('Нет оборудования непосредственно в этой группе')]),
            ...(commands.length?[panel(commands,'row','Управление')]:[]),
        ]));
    });
    const first=screens.find(s=>s.id===root)??screens[0];
    return view('auto-hmi',{title:options.title??p.title,bindings,body:first.body,screens,initial:first.id});
}
