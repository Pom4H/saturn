import type { Presentation, ViewNode } from './presentation';
import type { Controller, PlcBlock } from './controller';
import type { Endpoint, Connection, Attachment } from './ports';
import { AppError, id, type Expr, type System, type Simulation, type Project, type Derived, type Device, type AlarmRule, type Report, type Layout, type HistoryPolicy, type Control } from './types';
import { model, type builtInModels } from './models';
export interface ControlRef { control: Control; value: Expr; requested: Expr; blocked: Expr }
export const control = (name: string, options: Omit<Control, 'id' | 'unit' | 'step'> & Partial<Pick<Control, 'unit' | 'step'>>): ControlRef => ({
    control: { id: id(name), unit: 'отн.', step: .01, ...options },
    value: signal(`${name}.value`), requested: signal(`${name}.requested`), blocked: signal(`${name}.blocked`),
});
export const gt = (a: Expr, b: Expr): Expr => ({ op: 'gt', args: [a, b] });
export const lt = (a: Expr, b: Expr): Expr => ({ op: 'lt', args: [a, b] });
export const and = (...args: Expr[]): Expr => ({ op: 'and', args });
export const signal = (path: string): Expr => ({ ref: id(path) });
export const add = (...args: Expr[]): Expr => ({ op: 'add', args });
export const mul = (...args: Expr[]): Expr => ({ op: 'mul', args });
export const sub = (a: Expr, b: Expr): Expr => ({ op: 'sub', args: [a, b] });
export const div = (a: Expr, b: Expr): Expr => ({ op: 'div', args: [a, b] });
export const max = (...args: Expr[]): Expr => ({ op: 'max', args });
export const min = (...args: Expr[]): Expr => ({ op: 'min', args });
export const system = (name: string, title: string, parent?: string): System => ({ id: id(name), title, ...(parent ? { parent } : {}) });
type BuiltInModels = typeof builtInModels;
/** Module augmentation can add metadata for independently installed equipment. */
export interface ModelCatalog extends BuiltInModels {
}
export type SimRef<M = {
    outputs: Record<string, string>;
}> = {
    node: Simulation;
} & {
    readonly [K in M extends {
        outputs: infer O;
    } ? keyof O : never]: Expr;
};
type Options<M extends {
    inputs: object;
    parameters: object;
}> = {
    system: string;
    at: Layout;
    inputs?: Partial<Record<keyof M['inputs'], Expr>>;
    parameters?: Partial<Record<keyof M['parameters'], number>>;
    history?: Record<string, HistoryPolicy>;
};
/** Runtime metadata supplies validation and editor completion, including external installed models. */
export function simulation<K extends keyof ModelCatalog>(name: string, kind: K, options: Options<ModelCatalog[K]>): SimRef<ModelCatalog[K]> {
    const spec = model(kind), node: Simulation = { id: id(name), model: kind, system: options.system, parameters: { ...Object.fromEntries(Object.entries(spec.parameters).map(([k, v]) => [k, v.default])), ...options.parameters }, inputs: { ...spec.inputs, ...options.inputs }, layout: options.at, ...(options.history ? { history: options.history } : {}) };
    return Object.assign({ node }, Object.fromEntries(Object.keys(spec.outputs).map(k => [k, signal(`${name}.${k}`)]))) as SimRef<ModelCatalog[K]>;
}
export const derived = (name: string, expression: Expr, unit = 'отн.', history?: HistoryPolicy): Derived => ({ id: id(name), expression, unit, ...(history ? { history } : {}) });
export const equipment = (name: string, type: string, options: {
    system: string;
    at: Layout;
    signals: Record<string, Expr>;
}): Device => ({ id: id(name), type, system: options.system, layout: options.at, signals: options.signals });
export const alarm = (name: string, options: Omit<AlarmRule, 'id' | 'notify' | 'delay' | 'priority'> & Partial<Pick<AlarmRule, 'notify' | 'delay' | 'priority'>>): AlarmRule => ({ id: id(name), notify: true, delay: 1000, priority: 'warning', ...options });
export const report = (name: string, options: Omit<Report, 'id' | 'notify'> & {
    notify?: boolean;
}): Report => ({ id: id(name), notify: true, ...options });
export function project(name: string, options: Omit<Project, 'id' | 'version' | 'simulations' | 'devices' | 'stepMs' | 'seed' | 'history' | 'controls' | 'controllers'> & {
    simulations: {
        node: Simulation;
    }[];
    devices?: Device[];
    controls?: ControlRef[];
    controllers?: {controller:Controller}[];
    stepMs?: number;
    seed?: number;
    history?: Project['history'];
}): Project {
    const simulations = options.simulations.map(ref => ref.node);
    if (simulations.some(x => !x))
        throw new AppError('project.simulations expects simulation() references');
    const controllers = (options.controllers ?? []).map(c=>c.controller);
    const devices = options.devices ?? simulations.map(s => ({ id: s.id, type: model(s.model).visual, system: s.system, layout: s.layout, signals: Object.fromEntries(Object.keys(model(s.model).outputs).map(k => [k, signal(`${s.id}.${k}`)])) }));
    return { version: 1, id: id(name), stepMs: 100, seed: 1, history: { deadband: .001, maxInterval: 10000, retention: 86400000 }, ...options, simulations, controllers, devices: [...devices, ...controllers.map(c=>({id:c.id,type:'saturn',system:c.system,layout:c.layout,signals:Object.fromEntries([...Object.keys(c.outputs),'healthy','powered'].map(k=>[k,signal(`${c.id}.${k}`)]))}))], controls: (options.controls ?? []).map(c => c.control) };
}
/** Repeated equipment is expanded to ordinary stable-ID nodes before runtime execution. */
export function bank<K extends keyof ModelCatalog>(prefix: string, kind: K, options: Options<ModelCatalog[K]> & {
    count: number;
    columns: number;
    pitch: Layout;
}): SimRef<ModelCatalog[K]>[] {
    if (!Number.isInteger(options.count) || options.count < 1 || options.count > 128 || !Number.isInteger(options.columns) || options.columns < 1 || options.columns > 128)
        throw new AppError('Invalid bank dimensions');
    return Array.from({ length: options.count }, (_, i) => simulation(`${prefix}${i + 1}`, kind, { ...options, at: { x: options.at.x + (i % options.columns) * options.pitch.x, y: options.at.y + Math.floor(i / options.columns) * options.pitch.y } }));
}
export function aggregate<T extends {
    node: Simulation;
}>(items: T[], output: Exclude<keyof T, 'node'> & string, operation: 'mean' | 'sum' | 'min' | 'max' = 'mean'): Expr {
    if (!Array.isArray(items) || !items.length || items.length > 256)
        throw new AppError('Aggregate needs a bounded non-empty equipment list');
    const args = items.map(item => { if (!model(item.node.model).outputs[output])
        throw new AppError(`Unknown aggregate output: ${output}`); return signal(`${item.node.id}.${output}`); });
    if (operation === 'mean')
        return div(add(...args), args.length);
    if (operation === 'sum')
        return add(...args);
    if (operation === 'min')
        return min(...args);
    if (operation === 'max')
        return max(...args);
    throw new AppError('Unknown aggregate operation');
}

/** Installed PLC profile. Program refs are terminal names, not arbitrary signal expressions. */
export function plc<const O extends Record<string,Expr>>(name:string, options:Omit<Controller,'id'|'layout'|'profile'|'outputs'> & {at:Layout;outputs:O}) {
 const controller:Controller={id:id(name),profile:'saturn-fbd',system:options.system,layout:options.at,outputs:options.outputs,blocks:options.blocks,setpoints:options.setpoints,hmi:options.hmi};
 return Object.assign({controller},Object.fromEntries(Object.keys(options.outputs).map(k=>[k,signal(`${name}.${k}`)]))) as {controller:Controller}&{readonly[K in keyof O]:Expr};
}
export const pin=(name:string):Expr=>({ref:id(name)});
export const port=(device:string|{node:Simulation}|{controller:Controller}|Device,name:string):Endpoint=>({device:typeof device==='string'?id(device):'node' in device?device.node.id:'controller' in device?device.controller.id:device.id,port:name});
export const pipe=(name:string,from:Endpoint,to:Endpoint,options:Pick<Connection,'via'>={}):Connection=>({id:id(name),from,to,medium:'pipe',...options});
export const cable=(name:string,from:Endpoint,to:Endpoint,options:Omit<Connection,'id'|'from'|'to'>):Connection=>({id:id(name),from,to,...options});
export const expansion=(device:{node:Simulation},controller:{controller:Controller},slot:number):Attachment=>({device:device.node.id,controller:controller.controller.id,slot,profile:'virtual-io4'});

/** Controller-local stable block identity; separate from a physical terminal. */
export const block=(name:string):Expr=>({ref:id(name)});
export const setpoint=(name:string):Expr=>({ref:id(name)});
export const functionBlock=(type:PlcBlock['type'],inputs:Expr[],params:number[]=[]):PlcBlock=>({type,inputs,params});

/** Shared report/live-HMI blueprint; binding environments are explicit at each use. */
export const view=(name:string,options:Omit<Presentation,'id'>):Presentation=>({id:id(name),...options});
export const panel=(children:ViewNode[],direction:'row'|'column'='column',title?:string):ViewNode=>({kind:'group',children,direction,...(title?{title}:{})});
export const label=(text:string):ViewNode=>({kind:'text',text});
export const readout=(label:string,binding:string,unit='',digits=2):ViewNode=>({kind:'value',label,binding,unit,digits});
export const dataTable=(columns:Extract<ViewNode,{kind:'table'}>['columns']):ViewNode=>({kind:'table',columns});
export const trend=(title:string,x:string,y:string):ViewNode=>({kind:'chart',title,x,y});
export const commandButton=(label:string,target:string,value:number):ViewNode=>({kind:'action',label,target,value});
