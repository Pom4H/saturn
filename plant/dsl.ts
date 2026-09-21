import type { Presentation, ViewNode } from './presentation';
import { inputPins, type Controller, type PlcBlock } from './controller';
import { portRefs, physicalTypes, type Endpoint, type Connection, type Attachment, type DynamicEndpoint, type PhysicalType, type PortRefs, type Terminal, type TerminalOf, type TypedEndpoint } from './ports';
import { AppError, id, signalRef as createSignalRef, type Expr, type System, type Simulation, type Project, type Derived, type Device, type AlarmRule, type Report, type Layout, type HistoryPolicy, type Control, type Scalar, type SignalRef } from './types';
import { reportSchemaFields, type ReportSchema } from './reporting';
export { reportField, numberField, booleanField, textField, dateTimeField, reportSchema, reportColumn, excelColumn, asc, desc, excelSheet, workbook } from './reporting';
export type { ReportFieldRef, ReportSchema } from './reporting';
import { model, outputType, outputUnit, type builtInModels } from './models';
const simulationValue = Symbol('saturn.simulation');
const controllerValue = Symbol('saturn.controller');

export interface ControlRef<ID extends string = string, Unit extends string = string> {
    control: Control;
    value: SignalRef<`${ID}.value`, number, Unit>;
    requested: SignalRef<`${ID}.requested`, number, Unit>;
    blocked: SignalRef<`${ID}.blocked`, boolean, 'лог.'>;
}
type ControlOptions = Omit<Control, 'id' | 'unit' | 'step'> & Partial<Pick<Control, 'unit' | 'step'>>;
export function control<const ID extends string, const Options extends ControlOptions>(name: ID, options: Options): ControlRef<ID, Options extends { unit: infer Unit extends string } ? Unit : 'отн.'> {
    const unit = (options.unit ?? 'отн.') as Options extends { unit: infer Unit extends string } ? Unit : 'отн.';
    return {
        control: { id: id(name), unit, step: .01, ...options },
        value: createSignalRef(`${name}.value`, 'number', unit),
        requested: createSignalRef(`${name}.requested`, 'number', unit),
        blocked: createSignalRef(`${name}.blocked`, 'boolean', 'лог.'),
    };
}
export const gt = (a: Expr, b: Expr): Expr => ({ op: 'gt', args: [a, b] });
export const lt = (a: Expr, b: Expr): Expr => ({ op: 'lt', args: [a, b] });
export const and = (...args: Expr[]): Expr => ({ op: 'and', args });
export const signal = <const ID extends string>(path: ID): SignalRef<ID, number, ''> => createSignalRef(id(path) as ID, 'number', '');
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
type VisualOf<M> = M extends { visual: infer V extends PhysicalType } ? V : never;
type PortsOf<M,ID extends string> = [VisualOf<M>] extends [never] ? {} : PortRefs<VisualOf<M>,ID>;
type OutputDefinition<M, K extends PropertyKey> = M extends { outputs: infer Outputs }
    ? K extends keyof Outputs ? Outputs[K] : never
    : never;
type OutputUnit<M, K extends PropertyKey> = OutputDefinition<M, K> extends string
    ? OutputDefinition<M, K>
    : OutputDefinition<M, K> extends { unit: infer Unit extends string } ? Unit : string;
type OutputValue<M, K extends PropertyKey> = OutputDefinition<M, K> extends { type: 'boolean' }
    ? boolean
    : OutputDefinition<M, K> extends { type: 'string' } ? string : number;

export type SimRef<
    M = { outputs: {} },
    ID extends string = string,
    Kind extends string = string,
> = {
    readonly id: ID;
    readonly kind: Kind;
    readonly ports: PortsOf<M,ID>;
    readonly [simulationValue]: Simulation;
} & {
    readonly [K in M extends { outputs: infer O } ? keyof O : never]:
        SignalRef<`${ID}.${K & string}`, OutputValue<M, K>, OutputUnit<M, K>>;
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
export function simulation<const ID extends string, K extends keyof ModelCatalog>(name: ID, kind: K, options: Options<ModelCatalog[K]>): SimRef<ModelCatalog[K], ID, K & string> {
    const spec = model(kind), node: Simulation = { id: id(name), model: kind, system: options.system, parameters: { ...Object.fromEntries(Object.entries(spec.parameters).map(([k, v]) => [k, v.default])), ...options.parameters }, inputs: { ...spec.inputs, ...options.inputs }, layout: options.at, ...(options.history ? { history: options.history } : {}) };
    const ports = physicalTypes().includes(spec.visual) ? portRefs(node.id as ID, spec.visual as VisualOf<ModelCatalog[K]>) : {} as PortsOf<ModelCatalog[K],ID>;
    return Object.assign(
        { id: node.id as ID, kind: String(kind), ports, [simulationValue]: node },
        Object.fromEntries(Object.entries(spec.outputs).map(([k, definition]) => [k, createSignalRef(`${name}.${k}`, outputType(definition), outputUnit(definition))])),
    ) as SimRef<ModelCatalog[K], ID, K & string>;
}
export type DerivedRef<ID extends string = string, Unit extends string = string> = Derived & {
    readonly value: SignalRef<ID, number, Unit>;
};
export function derived<const ID extends string, const Unit extends string = 'отн.'>(name: ID, expression: Expr, unit?: Unit, history?: HistoryPolicy): DerivedRef<ID, Unit> {
    const resolvedUnit = (unit ?? 'отн.') as Unit;
    const result: Derived = { id: id(name), expression, unit: resolvedUnit, ...(history ? { history } : {}) };
    Object.defineProperty(result, 'value', { value: createSignalRef(name, 'number', resolvedUnit), enumerable: false });
    return result as DerivedRef<ID, Unit>;
}
export const equipment = (name: string, type: string, options: {
    system: string;
    at: Layout;
    signals: Record<string, Expr>;
}): Device => ({ id: id(name), type, system: options.system, layout: options.at, signals: options.signals });
export const alarm = (name: string, options: Omit<AlarmRule, 'id' | 'notify' | 'delay' | 'priority'> & Partial<Pick<AlarmRule, 'notify' | 'delay' | 'priority'>>): AlarmRule => ({ id: id(name), notify: true, delay: 1000, priority: 'warning', ...options });
type AuthoredReport = Omit<Report, 'id' | 'notify' | 'signals' | 'schema'> & {
    signals: readonly SignalRef<string, Scalar, string>[];
    schema?: ReportSchema<any>;
    notify?: boolean;
};
export function report(name: string, options: AuthoredReport): Report {
    const { signals, schema, ...rest } = options;
    return {
        id: id(name),
        notify: true,
        ...rest,
        signals: signals.map(signal => signal.ref),
        ...(schema ? { schema: reportSchemaFields(schema) } : {}),
    };
}
export function project(name: string, options: Omit<Project, 'id' | 'version' | 'simulations' | 'devices' | 'stepMs' | 'seed' | 'history' | 'controls' | 'controllers'> & {
    simulations: SimRef[];
    devices?: Device[];
    controls?: ControlRef[];
    controllers?: ControllerRef[];
    stepMs?: number;
    seed?: number;
    history?: Project['history'];
}): Project {
    const simulations = options.simulations.map(ref => ref[simulationValue]);
    if (simulations.some(x => !x))
        throw new AppError('project.simulations expects simulation() references');
    const controllers = (options.controllers ?? []).map(c => c[controllerValue]);
    const devices = options.devices ?? simulations.map(s => ({ id: s.id, type: model(s.model).visual, system: s.system, layout: s.layout, signals: Object.fromEntries(Object.keys(model(s.model).outputs).map(k => [k, signal(`${s.id}.${k}`)])) }));
    return { version: 1, id: id(name), stepMs: 100, seed: 1, history: { deadband: .001, maxInterval: 10000, retention: 86400000 }, ...options, simulations, controllers, devices: [...devices, ...controllers.map(c=>({id:c.id,type:'saturn',system:c.system,layout:c.layout,signals:Object.fromEntries([...Object.keys(c.outputs),'healthy','powered'].map(k=>[k,signal(`${c.id}.${k}`)]))}))], controls: (options.controls ?? []).map(c => c.control) };
}
/** Repeated equipment is expanded to ordinary stable-ID nodes before runtime execution. */
export function bank<K extends keyof ModelCatalog>(prefix: string, kind: K, options: Options<ModelCatalog[K]> & {
    count: number;
    columns: number;
    pitch: Layout;
}): SimRef<ModelCatalog[K], string, K & string>[] {
    if (!Number.isInteger(options.count) || options.count < 1 || options.count > 128 || !Number.isInteger(options.columns) || options.columns < 1 || options.columns > 128)
        throw new AppError('Invalid bank dimensions');
    return Array.from({ length: options.count }, (_, i) => simulation(`${prefix}${i + 1}`, kind, { ...options, at: { x: options.at.x + (i % options.columns) * options.pitch.x, y: options.at.y + Math.floor(i / options.columns) * options.pitch.y } }));
}
export function aggregate<T extends SimRef>(items: T[], output: Exclude<keyof T, 'id' | 'kind' | typeof simulationValue> & string, operation: 'mean' | 'sum' | 'min' | 'max' = 'mean'): Expr {
    if (!Array.isArray(items) || !items.length || items.length > 256)
        throw new AppError('Aggregate needs a bounded non-empty equipment list');
    const args = items.map(item => { const node = item[simulationValue]; if (!model(node.model).outputs[output])
        throw new AppError(`Unknown aggregate output: ${output}`); return signal(`${node.id}.${output}`); });
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

export type ControllerRef<ID extends string = string, O extends Record<string, Expr> = Record<string, Expr>> = {
    readonly id: ID;
    readonly profile: 'saturn-fbd';
    readonly ports: PortRefs<'saturn',ID>;
    readonly inputs: { readonly [K in keyof typeof inputPins & string]: SignalRef<`${ID}.${K}`, number, ''> };
    readonly healthy: SignalRef<`${ID}.healthy`, boolean, 'лог.'>;
    readonly powered: SignalRef<`${ID}.powered`, boolean, 'лог.'>;
    readonly [controllerValue]: Controller;
} & { readonly [K in keyof O]: SignalRef<`${ID}.${K & string}`, number, ''> };

/** Installed PLC profile. Program refs are terminal names, not arbitrary signal expressions. */
export function plc<const ID extends string, const O extends Record<string,Expr>>(name:ID, options:Omit<Controller,'id'|'layout'|'profile'|'outputs'> & {at:Layout;outputs:O}): ControllerRef<ID,O> {
 const controller:Controller={id:id(name),profile:'saturn-fbd',system:options.system,layout:options.at,outputs:options.outputs,blocks:options.blocks,hmi:options.hmi};
 return Object.assign({
   id:controller.id as ID,
   profile:controller.profile,
   ports:portRefs(controller.id as ID,'saturn'),
   inputs:Object.fromEntries(Object.keys(inputPins).map(k=>[k,createSignalRef(`${name}.${k}`,'number','')])),
   healthy:createSignalRef(`${name}.healthy`,'boolean','лог.'),
   powered:createSignalRef(`${name}.powered`,'boolean','лог.'),
   [controllerValue]:controller,
 },Object.fromEntries(Object.keys(options.outputs).map(k=>[k,createSignalRef(`${name}.${k}`,'number','')]))) as ControllerRef<ID,O>;
}
export const pin=(name:string):Expr=>({ref:id(name)});
export function port<M,ID extends string,Kind extends string,P extends keyof PortsOf<M,ID>&string>(device:SimRef<M,ID,Kind>,name:P):PortsOf<M,ID>[P];
export function port<ID extends string,O extends Record<string,Expr>,P extends keyof PortRefs<'saturn',ID>&string>(device:ControllerRef<ID,O>,name:P):PortRefs<'saturn',ID>[P];
export function port(device:string|Device,name:string):DynamicEndpoint;
export function port(device:string|SimRef|ControllerRef|Device,name:string):any {
 const deviceId=typeof device==='string'?id(device):device.id;
 if(typeof device!=='string'&&'ports' in device&&device.ports&&Object.hasOwn(device.ports,name))return (device.ports as Record<string,Endpoint>)[name];
 return {device:deviceId,port:name};
}
type FluidSource = TypedEndpoint<string,Terminal&{medium:'pipe';family:string;role:'source'|'passive'}>;
type FluidTarget<From extends FluidSource> = TypedEndpoint<string,Terminal&{medium:'pipe';family:TerminalOf<From>['family'];role:'sink'|'passive'}>;
export function pipe<const ID extends string,From extends FluidSource>(name:ID,from:From,to:FluidTarget<From>,options?:Pick<Connection,'via'>):Connection;
export function pipe(name:string,from:DynamicEndpoint,to:DynamicEndpoint,options?:Pick<Connection,'via'>):Connection;
export function pipe(name:string,from:Endpoint,to:Endpoint,options:Pick<Connection,'via'>={}):Connection {return{id:id(name),from,to,medium:'pipe',...options};}
type CableSource = TypedEndpoint<string,Terminal&{medium:'power'|'control'|'bus';family:string;role:'source'|'passive'}>;
type CableTarget<From extends CableSource> = TypedEndpoint<string,Terminal&{medium:TerminalOf<From>['medium'];family:TerminalOf<From>['family'];role:'sink'|'passive'}>;
type CableOptions<From extends CableSource> = Omit<Connection,'id'|'from'|'to'|'medium'>&{medium:TerminalOf<From>['medium']};
export function cable<const ID extends string,From extends CableSource>(name:ID,from:From,to:CableTarget<From>,options:CableOptions<From>):Connection;
export function cable(name:string,from:DynamicEndpoint,to:DynamicEndpoint,options:Omit<Connection,'id'|'from'|'to'>):Connection;
export function cable(name:string,from:Endpoint,to:Endpoint,options:Omit<Connection,'id'|'from'|'to'>):Connection {return{id:id(name),from,to,...options};}
export const expansion=(device:SimRef,controller:ControllerRef,slot:number):Attachment=>({device:device.id,controller:controller.id,slot,profile:'virtual-io4'});

/** Controller-local stable block identity; separate from a physical terminal. */
export const block=(name:string):Expr=>({ref:id(name)});
export const functionBlock=(type:PlcBlock['type'],inputs:Expr[],params:number[]=[]):PlcBlock=>({type,inputs,params});

/** Shared report/live-HMI blueprint; binding environments are explicit at each use. */
export const view=(name:string,options:Omit<Presentation,'id'>):Presentation=>({id:id(name),...options});
export const panel=(children:ViewNode[],direction:'row'|'column'='column',title?:string):ViewNode=>({kind:'group',children,direction,...(title?{title}:{})});
export const label=(text:string):ViewNode=>({kind:'text',text});
export const readout=(label:string,binding:string,unit='',digits=2):ViewNode=>({kind:'value',label,binding,unit,digits});
export const dataTable=(columns:Extract<ViewNode,{kind:'table'}>['columns']):ViewNode=>({kind:'table',columns});
export const trend=(title:string,x:string,y:string):ViewNode=>({kind:'chart',title,x,y});
export const commandButton=(label:string,target:string,value:number):ViewNode=>({kind:'action',label,target,value});
