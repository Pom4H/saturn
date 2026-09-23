import type { Presentation } from './presentation';
import type { Expr, Layout } from './types';
import { failCode } from './diagnostics';
import { FbdRuntime } from './vendor/saturn/src/runtime';
import { renderSaturnHmi, type SaturnHmiCommand, type SaturnHmiScene } from './hmi-frame';
import { buildSchema, type ElementSpec } from './vendor/saturn/src/builder';
import { ELEM } from './vendor/saturn/src/format';
import { runtimeHash as wasmSha256, STATE_ABI, type RuntimeSnapshot } from './vendor/firmverse/index';
export const CONTROLLER_ABI=STATE_ABI;
export interface PlcSetpoint { caption:string; min:number; max:number; initial:number; divider?:number; step?:number }
export interface Controller {
    id: string; profile: 'saturn-fbd'; system: string; layout: Layout;
    blocks?: Record<string, PlcBlock>;
    setpoints?: Record<string, PlcSetpoint>;
    outputs: Record<string, Expr>; hmi: { title: string; rows: { label: string; pin: string }[]; view?: Presentation; scene?: SaturnHmiScene };
}
export interface PlcBlock { type: 'TON'|'TP'|'RSTRG'|'DTRG'|'COUNTER'|'PID'|'SUM'|'SUMM'|'LIM'|'EQ'|'OR'|'XOR'; inputs: Expr[]; params?: number[] }
export interface ControllerState { inputs: Record<string, number>; outputs: Record<string, number>; healthy: boolean; powered: boolean; display?: SaturnHmiCommand[]; snapshot?: RuntimeSnapshot }
export const inputPins: Record<string, number> = Object.fromEntries([...Array.from({length:10},(_,i)=>[`DI${i+1}`,i+1]), ['AI1',11], ['AI2',12]]);
export const outputPins: Record<string, number> = Object.fromEntries([...Array.from({length:11},(_,i)=>[`DO${i+1}`,i+1]), ['AO1',12], ['AO2',13]]);
/** Named blocks compile once; stateful execution is checkpointed by Firmverse. */
export function compileController(c: Controller) {
    if(c.profile !== 'saturn-fbd' || !c.outputs || Object.keys(c.outputs).length<1 || Object.keys(c.outputs).length>13) failCode('SATURN_PLC_INVALID',{reason:'malformed'},{field:'profile'});
    const elements: ElementSpec[] = []; const used = new Set<string>(); const built=new Map<string,string>(),spBuilt=new Map<string,string>(),active=new Set<string>();const setpointOrder:string[]=[];let serial=0;
    for(const name of Object.keys(c.blocks??{})){if(!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)||Object.hasOwn(inputPins,name)||Object.hasOwn(c.setpoints??{},name))failCode('SATURN_PLC_INVALID',{reason:'unsafeName'},{field:'block.id',name});}
    for(const [name,sp] of Object.entries(c.setpoints??{})){
        if(!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)||Object.hasOwn(inputPins,name)||Object.hasOwn(c.blocks??{},name))failCode('SATURN_PLC_INVALID',{reason:'unsafeName'},{field:'setpoint.id',name});
        if(!sp||typeof sp.caption!=='string'||sp.caption.length>24||![sp.min,sp.max,sp.initial,sp.divider??0,sp.step??1].every(Number.isSafeInteger)||sp.min>sp.max||sp.initial<sp.min||sp.initial>sp.max||(sp.step??1)<=0)failCode('SATURN_PLC_INVALID',{reason:'range'},{field:'setpoint',name});
    }
    const blockKinds=new Set(['TON','TP','RSTRG','DTRG','COUNTER','PID','SUM','SUMM','LIM','EQ','OR','XOR']);
    const push = (spec: Omit<ElementSpec,'id'>, name='e'+serial++):string => { elements.push({id:name,...spec}); if(elements.length>256)failCode('SATURN_LIMIT',{resource:'plc.blocks',reason:'tooMany'},{max:256});return name; };
    const expr = (v: Expr, depth=0):string => {
        if(depth>32) failCode('SATURN_LIMIT',{resource:'plc.expression',reason:'nestingLimit'},{maxDepth:32});
        if(typeof v==='number'||typeof v==='boolean') { const n=Number(v); if(!Number.isSafeInteger(n)||n< -2147483648||n>2147483647) failCode('SATURN_PLC_INVALID',{reason:'range'},{field:'constant',value:n,min:-2147483648,max:2147483647});return push({type:ELEM.CONST,params:[n]}); }
        if(!v||typeof v!=='object')failCode('SATURN_PLC_INVALID',{reason:'malformed'},{field:'expression'});
        if('ref' in v) {
            if(Object.hasOwn(c.setpoints??{},v.ref)){
                if(spBuilt.has(v.ref))return spBuilt.get(v.ref)!;
                const sp=c.setpoints![v.ref],name='setpoint_'+v.ref;
                push({type:ELEM.SP,params:[sp.min,sp.max,sp.initial,sp.divider??0,sp.step??1],caption:sp.caption},name);
                spBuilt.set(v.ref,name);setpointOrder.push(v.ref);return name;
            }
            if(Object.hasOwn(c.blocks??{},v.ref)){
                if(built.has(v.ref))return built.get(v.ref)!;
                if(active.has(v.ref))failCode('SATURN_PLC_INVALID',{reason:'cycle'},{block:v.ref});
                const b=c.blocks![v.ref];if(!b||!blockKinds.has(b.type)||!Array.isArray(b.inputs))failCode('SATURN_PLC_INVALID',{reason:'invalid'},{field:'block.type',block:v.ref});
                active.add(v.ref);const inputs=b.inputs.map(i=>expr(i,depth+1));active.delete(v.ref);
                const name=push({type:b.type,inputs,params:b.params??[]},'block_'+v.ref);built.set(v.ref,name);return name;
            }
            if(!Object.hasOwn(inputPins,v.ref))failCode('SATURN_DSL_UNKNOWN',{kind:'plcInput',name:v.ref},{input:v.ref});
            used.add(v.ref);const name='input_'+v.ref;if(!elements.some(e=>e.id===name))push({type:ELEM.INP_PIN,params:[inputPins[v.ref]]},name);return name;
        }
        const operators = {gt:ELEM.CMP,lt:ELEM.CMP,and:ELEM.AND,not:ELEM.NOT,min:ELEM.MIN,max:ELEM.MAX};
        if(!Object.hasOwn(operators,v.op)||!Array.isArray(v.args)) failCode('SATURN_PLC_INVALID',{reason:'unsupportedOperator'},{operator:v.op});
        const count = v.op==='not'?1:2;if(v.args.length!==count)failCode('SATURN_PLC_INVALID',{reason:'malformed'},{operator:v.op,expectedOperands:count,actualOperands:v.args.length});
        const args=v.args.map(a=>expr(a,depth+1)); if(v.op==='lt')args.reverse();
        return push({type:operators[v.op as keyof typeof operators],inputs:args});
    };
    const bindings:Record<string,string>={};
    for(const pin of Object.keys(c.outputs).sort()){
        if(!Object.hasOwn(outputPins,pin))failCode('SATURN_DSL_UNKNOWN',{kind:'plcOutput',name:pin},{output:pin});
        bindings[pin]=expr(c.outputs[pin]);push({type:ELEM.OUT_PIN,inputs:[bindings[pin]],params:[outputPins[pin]]},'output_'+pin);
    }
    if(!c.hmi||typeof c.hmi.title!=='string'||c.hmi.title.length>36||!Array.isArray(c.hmi.rows)||c.hmi.rows.length>6)failCode('SATURN_PLC_INVALID',{reason:'malformed'},{field:'hmi'});
    for(const row of c.hmi.rows){ if(typeof row.label!=='string'||row.label.length>24)failCode('SATURN_LIMIT',{resource:'hmi.label',reason:'tooLarge'},{max:24});
        if(!bindings[row.pin]) { if(!Object.hasOwn(inputPins,row.pin))failCode('SATURN_PLC_INVALID',{reason:'unknown'},{field:'hmi.pin',pin:row.pin});bindings[row.pin]=expr({ref:row.pin}); }
    }
    // FBD remains a bounded simulation/legacy logic backend only. Rich physical HMI
    // is compiled separately from canonical Presentation to C23/satgui.
    const compiled=buildSchema(elements,{projectName:c.id,projectVersion:'1.0',buildTime:'reproducible'});
    return {...compiled, inputs:[...used].sort(), setpointOrder, runtimeHash:wasmSha256, profile:'saturn-fbd/state-v1', hardwareVerified:false};
}
export class ControllerVM {
    readonly artifact: ReturnType<typeof compileController>; private runtime:FbdRuntime;
    constructor(readonly controller:Controller) { this.artifact=compileController(controller);this.runtime=FbdRuntime.createSync();const loaded=this.runtime.load(this.artifact.fbdbin);if(!loaded.ok)failCode('SATURN_RUNTIME_INVALID',{reason:'runtimeRejected'},{detail:loaded.message}); }
    snapshot():RuntimeSnapshot {return this.runtime.snapshot();}
    restore(snapshot:RuntimeSnapshot):void {this.runtime.restore(snapshot);}
    reset():void {this.runtime.reset();}
    setSetpoint(name:string,value?:number,deltaSteps?:number):void {
        const index=this.artifact.setpointOrder.indexOf(name);if(index<0)failCode('SATURN_NOT_FOUND',{resource:'setpoint',id:name},{name});
        const point=this.runtime.getSetpoint(index),next=value??Math.max(point.lowLimit,Math.min(point.upperLimit,point.value+(deltaSteps??0)*point.step));
        this.runtime.setSetpoint(index,next);
    }
    getSetpoint(name:string){const index=this.artifact.setpointOrder.indexOf(name);if(index<0)failCode('SATURN_NOT_FOUND',{resource:'setpoint',id:name},{name});return this.runtime.getSetpoint(index);}
    scan(inputs:Record<string,number>, dt:number, timeMs:number):{outputs:Record<string,number>;hmi:SaturnHmiCommand[]} {
        for(const [pin,index] of Object.entries(inputPins)) { const value=inputs[pin]??0;if(!Number.isSafeInteger(value)||value< -2147483648||value>2147483647)failCode('SATURN_PLC_INVALID',{reason:'range'},{field:'input',pin,value,min:-2147483648,max:2147483647});this.runtime.setInput(index,value); }
        this.runtime.step(dt);
        const outputs=Object.fromEntries(Object.keys(this.controller.outputs).map(pin=>[pin,Number(this.runtime.getOutput(outputPins[pin]))]));
        const signals={...inputs,...outputs};
        const scene=this.controller.hmi.scene??{
            background:0x0024,
            nodes:[
                {kind:'text' as const,x:10,y:10,text:this.controller.hmi.title,color:0xffff,size:14,weight:700},
                ...this.controller.hmi.rows.flatMap((row,index)=>[
                    {kind:'text' as const,x:10,y:42+index*30,text:row.label,color:0xbdf7,size:11,weight:600},
                    {kind:'text' as const,x:300,y:42+index*30,text:{value:{signal:row.pin},digits:0},color:0xffff,size:14,weight:700,align:'end' as const,mono:true},
                ]),
            ],
        } satisfies SaturnHmiScene;
        return {outputs,hmi:renderSaturnHmi(scene,signals,timeMs).commands};
    }
}
