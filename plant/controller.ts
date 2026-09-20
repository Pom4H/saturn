import { presentationHmi } from './presentation-hmi';
import type { Presentation } from './presentation';
import { AppError, type Expr, type Layout } from './types';
import { FbdRuntime, type HmiDrawCommand } from './vendor/saturn/src/runtime';
import { buildSchema, type ElementSpec } from './vendor/saturn/src/builder';
import { ELEM } from './vendor/saturn/src/format';
import { compileHmiScreens } from './vendor/saturn/src/hmi-compile';
import type { HmiScreenModel } from './vendor/saturn/src/types';
import { runtimeHash as wasmSha256, STATE_ABI, type RuntimeSnapshot } from './vendor/firmverse/index';
export const CONTROLLER_ABI=STATE_ABI;
export type ControllerKey = 'up'|'down'|'left'|'right';
export interface ControllerHmi {
    title: string;
    rows: { label: string; pin: string }[];
    view?: Presentation;
    /** Native 320x240 controller screens compiled into the .fbdbin. */
    screens?: HmiScreenModel[];
    initial?: string;
    /** Physical front-panel key navigation. Omitted keys fall back to cyclic navigation. */
    keys?: Record<string, Partial<Record<ControllerKey,string>>>;
}
export interface Controller {
    id: string; profile: 'saturn-fbd'; system: string; layout: Layout;
    blocks?: Record<string, PlcBlock>;
    outputs: Record<string, Expr>; hmi: ControllerHmi;
}
export interface PlcBlock { type: 'TON'|'TP'|'RSTRG'|'DTRG'|'COUNTER'|'PID'|'SUM'|'SUMM'|'LIM'|'EQ'|'OR'|'XOR'; inputs: Expr[]; params?: number[] }
export interface ControllerState { inputs: Record<string, number>; outputs: Record<string, number>; healthy: boolean; powered: boolean; screen: number; display?: HmiDrawCommand[]; snapshot?: RuntimeSnapshot }
export const inputPins: Record<string, number> = Object.fromEntries([...Array.from({length:10},(_,i)=>[`DI${i+1}`,i+1]), ['AI1',11], ['AI2',12]]);
export const outputPins: Record<string, number> = Object.fromEntries([...Array.from({length:11},(_,i)=>[`DO${i+1}`,i+1]), ['AO1',12], ['AO2',13]]);

export function controllerScreenIds(c:Controller): string[] {
    if(c.hmi.screens?.length) return c.hmi.screens.map(screen=>screen.id);
    if(c.hmi.view) return [c.hmi.view.id];
    return ['main'];
}
export function initialControllerScreen(c:Controller): number {
    const ids=controllerScreenIds(c), initial=c.hmi.initial ?? ids[0], index=ids.indexOf(initial);
    if(index<0) throw new AppError('Unknown initial controller HMI screen');
    return index;
}
export function controllerScreenAfterKey(c:Controller,current:number,key:ControllerKey):number {
    const ids=controllerScreenIds(c);
    if(!ids.length) return 0;
    const safe=((current%ids.length)+ids.length)%ids.length, currentId=ids[safe];
    const explicit=c.hmi.keys?.[currentId]?.[key];
    if(explicit!==undefined) {
        const target=ids.indexOf(explicit);
        if(target<0) throw new AppError('Unknown controller HMI navigation target');
        return target;
    }
    if(ids.length===1) return 0;
    const delta=key==='right'||key==='down'?1:-1;
    return (safe+delta+ids.length)%ids.length;
}

/** Named blocks compile once; stateful execution is checkpointed by Firmverse. */
export function compileController(c: Controller) {
    if(c.profile !== 'saturn-fbd' || !c.outputs || Object.keys(c.outputs).length<1 || Object.keys(c.outputs).length>13) throw new AppError('Invalid Saturn profile');
    const elements: ElementSpec[] = []; const used = new Set<string>(); const built=new Map<string,string>(),active=new Set<string>();let serial=0;
    for(const name of Object.keys(c.blocks??{})){if(!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)||Object.hasOwn(inputPins,name))throw new AppError('Invalid or ambiguous PLC block ID');}
    const blockKinds=new Set(['TON','TP','RSTRG','DTRG','COUNTER','PID','SUM','SUMM','LIM','EQ','OR','XOR']);
    const push = (spec: Omit<ElementSpec,'id'>, name='e'+serial++):string => { elements.push({id:name,...spec}); if(elements.length>256)throw new AppError('PLC program exceeds 256 blocks');return name; };
    const expr = (v: Expr, depth=0):string => {
        if(depth>32) throw new AppError('PLC expression depth');
        if(typeof v==='number'||typeof v==='boolean') { const n=Number(v); if(!Number.isSafeInteger(n)||n< -2147483648||n>2147483647) throw new AppError('PLC constants must be int32');return push({type:ELEM.CONST,params:[n]}); }
        if(!v||typeof v!=='object')throw new AppError('Invalid PLC expression');
        if('ref' in v) {
            if(Object.hasOwn(c.blocks??{},v.ref)){
                if(built.has(v.ref))return built.get(v.ref)!;
                if(active.has(v.ref))throw new AppError('PLC graph cycle requires an explicit memory block');
                const b=c.blocks![v.ref];if(!b||!blockKinds.has(b.type)||!Array.isArray(b.inputs))throw new AppError('Unsupported PLC block');
                active.add(v.ref);const inputs=b.inputs.map(i=>expr(i,depth+1));active.delete(v.ref);
                const name=push({type:b.type,inputs,params:b.params??[]},'block_'+v.ref);built.set(v.ref,name);return name;
            }
            if(!Object.hasOwn(inputPins,v.ref))throw new AppError('Unknown supported PLC input '+v.ref);
            used.add(v.ref);const name='input_'+v.ref;if(!elements.some(e=>e.id===name))push({type:ELEM.INP_PIN,params:[inputPins[v.ref]]},name);return name;
        }
        const operators = {gt:ELEM.CMP,lt:ELEM.CMP,and:ELEM.AND,not:ELEM.NOT,min:ELEM.MIN,max:ELEM.MAX};
        if(!Object.hasOwn(operators,v.op)||!Array.isArray(v.args)) throw new AppError('PLC profile accepts comparisons, boolean gates, min/max; no arithmetic overflow or timers');
        const count = v.op==='not'?1:2;if(v.args.length!==count)throw new AppError(`PLC ${v.op} requires ${count} operands`);
        const args=v.args.map(a=>expr(a,depth+1)); if(v.op==='lt')args.reverse();
        return push({type:operators[v.op as keyof typeof operators],inputs:args});
    };
    const bindings:Record<string,string>={};
    for(const pin of Object.keys(c.outputs).sort()){
        if(!Object.hasOwn(outputPins,pin))throw new AppError('Unknown supported PLC output '+pin);
        bindings[pin]=expr(c.outputs[pin]);push({type:ELEM.OUT_PIN,inputs:[bindings[pin]],params:[outputPins[pin]]},'output_'+pin);
    }
    if(!c.hmi||typeof c.hmi.title!=='string'||c.hmi.title.length>36||!Array.isArray(c.hmi.rows)||c.hmi.rows.length>6)throw new AppError('Invalid 320x240 HMI');
    for(const row of c.hmi.rows){ if(typeof row.label!=='string'||row.label.length>24)throw new AppError('HMI label too long');
        if(!bindings[row.pin]) { if(!Object.hasOwn(inputPins,row.pin))throw new AppError('HMI pin not in compiled program');bindings[row.pin]=expr({ref:row.pin}); }
    }
    const resolveHmiRef=(ref:string):string=>{
        if(bindings[ref]) return bindings[ref];
        if(Object.hasOwn(inputPins,ref)) return bindings[ref]=expr({ref});
        if(Object.hasOwn(c.blocks??{},ref)) return expr({ref});
        return ref;
    };
    let screenModels: HmiScreenModel[];
    if(c.hmi.screens?.length) {
        if(c.hmi.screens.length>16) throw new AppError('At most 16 controller HMI screens');
        const ids=new Set<string>();
        screenModels=c.hmi.screens.map(screen=>{
            if(!/^[A-Za-z][A-Za-z0-9_.-]{0,95}$/.test(screen.id)||ids.has(screen.id))throw new AppError('Invalid or duplicate controller HMI screen');
            ids.add(screen.id);
            return {...screen,elements:screen.elements.map(element=>({
                ...element,
                ...(element.binding?{binding:{...element.binding,ref:resolveHmiRef(element.binding.ref)}}:{}),
                ...(element.visible?{visible:{...element.visible,ref:resolveHmiRef(element.visible.ref)}}:{}),
            }))};
        });
        const initial=c.hmi.initial??screenModels[0].id;if(!ids.has(initial))throw new AppError('Unknown initial controller HMI screen');
        for(const [from,map] of Object.entries(c.hmi.keys??{})){
            if(!ids.has(from))throw new AppError('Unknown controller HMI navigation source');
            for(const to of Object.values(map))if(to!==undefined&&!ids.has(to))throw new AppError('Unknown controller HMI navigation target');
        }
    } else if(c.hmi.view) {
        const viewBindings=Object.fromEntries(Object.entries(c.hmi.view.bindings).map(([key,value])=>[key,expr(value)]));
        screenModels=[presentationHmi(c.hmi.view,viewBindings)];
    } else screenModels=[{id:'main',title:c.hmi.title,screenType:'main',period:0,elements:[
        {id:'title',primitive:'text',label:c.hmi.title,position:{x:10,y:8}},
        ...c.hmi.rows.map((r,i)=>({id:'row'+i,primitive:'value' as const,label:r.label+' ',position:{x:10,y:40+i*29},binding:{source:'wp' as const,ref:bindings[r.pin],format:'int' as const}})),
    ]}];
    const screens=compileHmiScreens(screenModels,{elementIndex:new Map(elements.map((e,i)=>[e.id,i]))});
    const compiled=buildSchema(elements,{projectName:c.id,projectVersion:'1.0',buildTime:'reproducible',screens});
    return {...compiled, inputs:[...used].sort(), runtimeHash:wasmSha256, profile:'saturn-fbd/state-v1', hardwareVerified:false};
}
export class ControllerVM {
    readonly artifact: ReturnType<typeof compileController>; private runtime:FbdRuntime;
    constructor(readonly controller:Controller) { this.artifact=compileController(controller);this.runtime=FbdRuntime.createSync();const loaded=this.runtime.load(this.artifact.fbdbin);if(!loaded.ok)throw new AppError(loaded.message); }
    snapshot():RuntimeSnapshot {return this.runtime.snapshot();}
    restore(snapshot:RuntimeSnapshot):void {this.runtime.restore(snapshot);}
    reset():void {this.runtime.reset();}
    scan(inputs:Record<string,number>, dt:number, screen=0):{outputs:Record<string,number>;hmi:HmiDrawCommand[]} {
        for(const [pin,index] of Object.entries(inputPins)) { const value=inputs[pin]??0;if(!Number.isSafeInteger(value)||value< -2147483648||value>2147483647)throw new AppError('PLC input outside int32: '+pin);this.runtime.setInput(index,value); }
        const hmi=this.runtime.stepAndRenderScreen(dt,screen);
        return {outputs:Object.fromEntries(Object.keys(this.controller.outputs).map(pin=>[pin,Number(this.runtime.getOutput(outputPins[pin]))])),hmi};
    }
}
