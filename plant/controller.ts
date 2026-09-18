import { AppError, type Expr, type Layout } from './types';
import { FbdRuntime, type HmiDrawCommand } from './vendor/saturn/src/runtime';
import { buildSchema, type ElementSpec } from './vendor/saturn/src/builder';
import { ELEM } from './vendor/saturn/src/format';
import { compileHmiScreens } from './vendor/saturn/src/hmi-compile';
import { wasmSha256 } from './vendor/saturn/runtime/binary';
export const CONTROLLER_ABI='saturn-fbd/combinational-v1:'+wasmSha256;
export interface Controller {
    id: string; profile: 'saturn-fbd'; system: string; layout: Layout;
    outputs: Record<string, Expr>; hmi: { title: string; rows: { label: string; pin: string }[] };
}
export interface ControllerState { inputs: Record<string, number>; outputs: Record<string, number>; healthy: boolean; powered: boolean }
export const inputPins: Record<string, number> = Object.fromEntries([...Array.from({length:10},(_,i)=>[`DI${i+1}`,i+1]), ['AI1',11], ['AI2',12]]);
export const outputPins: Record<string, number> = Object.fromEntries([...Array.from({length:11},(_,i)=>[`DO${i+1}`,i+1]), ['AO1',12], ['AO2',13]]);
/** Integer combinational profile. Stateful FBD blocks and RTC require an explicit checkpoint ABI. */
export function compileController(c: Controller) {
    if(c.profile !== 'saturn-fbd' || !c.outputs || Object.keys(c.outputs).length<1 || Object.keys(c.outputs).length>13) throw new AppError('Invalid Saturn profile');
    const elements: ElementSpec[] = []; const used = new Set<string>(); let serial=0;
    const push = (spec: Omit<ElementSpec,'id'>, name='e'+serial++):string => { elements.push({id:name,...spec}); if(elements.length>256)throw new AppError('PLC program exceeds 256 blocks');return name; };
    const expr = (v: Expr, depth=0):string => {
        if(depth>32) throw new AppError('PLC expression depth');
        if(typeof v==='number'||typeof v==='boolean') { const n=Number(v); if(!Number.isSafeInteger(n)||n< -2147483648||n>2147483647) throw new AppError('PLC constants must be int32');return push({type:ELEM.CONST,params:[n]}); }
        if(!v||typeof v!=='object')throw new AppError('Invalid PLC expression');
        if('ref' in v) { if(!Object.hasOwn(inputPins,v.ref))throw new AppError('Unknown supported PLC input '+v.ref);used.add(v.ref);const name='input_'+v.ref;if(!elements.some(e=>e.id===name))push({type:ELEM.INP_PIN,params:[inputPins[v.ref]]},name);return name; }
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
    const screens=compileHmiScreens([{id:'main',title:c.hmi.title,screenType:'main',period:0,elements:[
        {id:'title',primitive:'text',label:c.hmi.title,position:{x:10,y:8}},
        ...c.hmi.rows.map((r,i)=>({id:'row'+i,primitive:'value' as const,label:r.label+' ',position:{x:10,y:40+i*29},binding:{source:'wp' as const,ref:bindings[r.pin],format:'int' as const}})),
    ]}],{elementIndex:new Map(elements.map((e,i)=>[e.id,i]))});
    const compiled=buildSchema(elements,{projectName:c.id,projectVersion:'1.0',buildTime:'reproducible',screens});
    return {...compiled, inputs:[...used].sort(), runtimeHash:wasmSha256, profile:'saturn-fbd/combinational-v1', hardwareVerified:false};
}
export class ControllerVM {
    readonly artifact: ReturnType<typeof compileController>; private runtime:FbdRuntime;
    constructor(readonly controller:Controller) { this.artifact=compileController(controller);this.runtime=FbdRuntime.createSync();const loaded=this.runtime.load(this.artifact.fbdbin);if(!loaded.ok)throw new AppError(loaded.message); }
    scan(inputs:Record<string,number>, dt:number):{outputs:Record<string,number>;hmi:HmiDrawCommand[]} {
        for(const [pin,index] of Object.entries(inputPins)) { const value=inputs[pin]??0;if(!Number.isSafeInteger(value)||value< -2147483648||value>2147483647)throw new AppError('PLC input outside int32: '+pin);this.runtime.setInput(index,value); }
        const hmi=this.runtime.stepAndRenderScreen(dt);
        return {outputs:Object.fromEntries(Object.keys(this.controller.outputs).map(pin=>[pin,Number(this.runtime.getOutput(outputPins[pin]))])),hmi};
    }
}
