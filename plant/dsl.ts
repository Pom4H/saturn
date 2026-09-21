import type { Presentation, ViewNode } from './presentation';
import { inputPins, type Controller, type PlcBlock } from './controller';
import { portRefs, physicalTypes, type Endpoint, type Connection, type Attachment, type DynamicEndpoint, type PhysicalType, type PortRefs, type Terminal, type TerminalOf, type TypedEndpoint } from './ports';
import { AppError, expressionInfo, expressionMetadata, id, signalRef as createSignalRef, type Expr, type OperationExpr, type SignalDimension, type SignalDimensionOf, type System, type Simulation, type Project, type Derived, type Device, type AlarmRule, type Report, type Layout, type HistoryPolicy, type Control, type Scalar, type SignalRef } from './types';
import { failDiagnostic } from './diagnostics';
import { reportSchemaFields, type ReportSchema } from './reporting';
export { reportField, numberField, booleanField, textField, dateTimeField, reportSchema, reportColumn, excelColumn, asc, desc, excelSheet, workbook } from './reporting';
export type { ReportFieldRef, ReportSchema } from './reporting';
import { model, outputType, type builtInModels } from './models';
const simulationValue = Symbol('saturn.simulation');
const controllerValue = Symbol('saturn.controller');

export interface ControlRef<ID extends string = string, Unit extends string = string> {
    control: Control;
    value: SignalRef<`${ID}.value`, number, Unit, 'unknown'>;
    requested: SignalRef<`${ID}.requested`, number, Unit, 'unknown'>;
    blocked: SignalRef<`${ID}.blocked`, boolean, 'лог.', 'boolean'>;
}
type ControlOptions = Omit<Control, 'id' | 'unit' | 'step'> & Partial<Pick<Control, 'unit' | 'step'>>;
export function control<const ID extends string, const Options extends ControlOptions>(name: ID, options: Options): ControlRef<ID, Options extends { unit: infer Unit extends string } ? Unit : 'отн.'> {
    const unit = (options.unit ?? 'отн.') as Options extends { unit: infer Unit extends string } ? Unit : 'отн.';
    return {
        control: { id: id(name), unit, step: .01, ...options },
        value: createSignalRef(`${name}.value`, 'number', unit, 'unknown'),
        requested: createSignalRef(`${name}.requested`, 'number', unit, 'unknown'),
        blocked: createSignalRef(`${name}.blocked`, 'boolean', 'лог.', 'boolean'),
    };
}
type NumericSignal<Dimension extends SignalDimension = SignalDimension> = SignalRef<string, number, string, Dimension>;
type NumericOperation<Dimension extends SignalDimension = SignalDimension> = OperationExpr<number, Dimension>;
type NumericTyped = NumericSignal | NumericOperation;
export type NumericExpr<Dimension extends SignalDimension = 'unknown'> = number | NumericSignal<Dimension> | NumericOperation<Dimension>;
export type BooleanExpr = boolean | SignalRef<string, boolean, string, SignalDimension> | OperationExpr<boolean, 'boolean'>;
type DimensionOf<E> = E extends SignalRef<string, number, string, infer Dimension> ? Dimension : E extends OperationExpr<number, infer Dimension> ? Dimension : 'unknown';
type CompatibleNumeric<Dimension extends SignalDimension> = Dimension extends 'unknown'
    ? number | NumericTyped
    : number | NumericSignal<Dimension> | NumericOperation<Dimension> | NumericSignal<'unknown'> | NumericOperation<'unknown'>;
const operation = <Value extends Scalar, Dimension extends SignalDimension>(
    op: OperationExpr<Value, Dimension>['op'],
    args: Expr[],
    metadata?: { type: 'number'|'boolean'|'string'; dimension: SignalDimension },
): OperationExpr<Value, Dimension> => {
    const value = { op, args };
    if (metadata) Object.defineProperty(value, expressionMetadata, { value: metadata, enumerable: false });
    return value as unknown as OperationExpr<Value, Dimension>;
};

export function gt<A extends NumericTyped>(a: A, b: CompatibleNumeric<DimensionOf<A>>): OperationExpr<boolean, 'boolean'>;
export function gt<B extends NumericTyped>(a: number, b: B): OperationExpr<boolean, 'boolean'>;
export function gt(a: number, b: number): OperationExpr<boolean, 'boolean'>;
export function gt(a: Expr, b: Expr): OperationExpr<boolean, 'boolean'> { return operation('gt', [a, b], { type:'boolean', dimension:'boolean' }); }
export function lt<A extends NumericTyped>(a: A, b: CompatibleNumeric<DimensionOf<A>>): OperationExpr<boolean, 'boolean'>;
export function lt<B extends NumericTyped>(a: number, b: B): OperationExpr<boolean, 'boolean'>;
export function lt(a: number, b: number): OperationExpr<boolean, 'boolean'>;
export function lt(a: Expr, b: Expr): OperationExpr<boolean, 'boolean'> { return operation('lt', [a, b], { type:'boolean', dimension:'boolean' }); }
export const and = (...args: BooleanExpr[]): OperationExpr<boolean, 'boolean'> => operation('and', args as Expr[], { type:'boolean', dimension:'boolean' });
export const signal = <const ID extends string>(path: ID): SignalRef<ID, number, '', 'unknown'> => createSignalRef(id(path) as ID, 'number', '', 'unknown');

export function add<A extends NumericTyped>(a: A, ...args: CompatibleNumeric<DimensionOf<A>>[]): OperationExpr<number, DimensionOf<A>>;
export function add(a: number, ...args: number[]): OperationExpr<number, 'scalar'>;
export function add(...args: Expr[]): OperationExpr<number, SignalDimension> { return operation('add', args, { type:'number', dimension: expressionInfo(args[0])?.dimension ?? 'unknown' }); }
export function mul<A extends NumericTyped>(a: A, ...factors: number[]): OperationExpr<number, DimensionOf<A>>;
export function mul(...args: number[]): OperationExpr<number, 'scalar'>;
export function mul(...args: Expr[]): OperationExpr<number, SignalDimension> { return operation('mul', args, { type:'number', dimension: expressionInfo(args.find(value => typeof value !== 'number'))?.dimension ?? 'scalar' }); }
export function sub<A extends NumericTyped>(a: A, b: CompatibleNumeric<DimensionOf<A>>): OperationExpr<number, DimensionOf<A>>;
export function sub(a: number, b: number): OperationExpr<number, 'scalar'>;
export function sub(a: Expr, b: Expr): OperationExpr<number, SignalDimension> { return operation('sub', [a, b], { type:'number', dimension: expressionInfo(a)?.dimension ?? 'unknown' }); }
export function div<A extends NumericTyped>(a: A, b: number): OperationExpr<number, DimensionOf<A>>;
export function div<A extends NumericTyped>(a: A, b: CompatibleNumeric<DimensionOf<A>>): OperationExpr<number, 'scalar'>;
export function div(a: number, b: number): OperationExpr<number, 'scalar'>;
export function div(a: Expr, b: Expr): OperationExpr<number, SignalDimension> { return operation('div', [a, b], { type:'number', dimension: typeof b === 'number' ? (expressionInfo(a)?.dimension ?? 'unknown') : 'scalar' }); }
export function max<A extends NumericTyped>(a: A, ...args: CompatibleNumeric<DimensionOf<A>>[]): OperationExpr<number, DimensionOf<A>>;
export function max(a: number, ...args: number[]): OperationExpr<number, 'scalar'>;
export function max(...args: Expr[]): OperationExpr<number, SignalDimension> { return operation('max', args, { type:'number', dimension: expressionInfo(args[0])?.dimension ?? 'unknown' }); }
export function min<A extends NumericTyped>(a: A, ...args: CompatibleNumeric<DimensionOf<A>>[]): OperationExpr<number, DimensionOf<A>>;
export function min(a: number, ...args: number[]): OperationExpr<number, 'scalar'>;
export function min(...args: Expr[]): OperationExpr<number, SignalDimension> { return operation('min', args, { type:'number', dimension: expressionInfo(args[0])?.dimension ?? 'unknown' }); }
export const system = (name: string, title: string, parent?: string): System => ({ id: id(name), title, ...(parent ? { parent } : {}) });
type BuiltInModels = typeof builtInModels;
/** Module augmentation can add metadata for independently installed equipment. */
export interface ModelCatalog extends BuiltInModels {
}
type VisualOf<M> = M extends { visual: infer V extends PhysicalType } ? V : never;
type PortsOf<M,ID extends string> = [VisualOf<M>] extends [never] ? {} : PortRefs<VisualOf<M>,ID>;
type OutputUnit<M, K extends PropertyKey> = M extends { outputs: infer Outputs }
    ? K extends keyof Outputs
        ? Outputs[K] extends string ? Outputs[K] : string
        : string
    : string;
type OutputDeclaredType<M, K extends PropertyKey> = M extends { outputTypes: infer Types }
    ? K extends keyof Types ? Types[K] : 'number'
    : 'number';
type OutputDimension<M, K extends PropertyKey> = M extends { outputDimensions: infer Dimensions }
    ? K extends keyof Dimensions ? Dimensions[K] extends SignalDimension ? Dimensions[K] : 'unknown' : 'unknown'
    : 'unknown';
type OutputValue<M, K extends PropertyKey> = OutputDeclaredType<M, K> extends 'boolean'
    ? boolean
    : OutputDeclaredType<M, K> extends 'string' ? string : number;
type InputDeclaredType<M, K extends PropertyKey> = M extends { inputTypes: infer Types }
    ? K extends keyof Types ? Types[K] : 'number'
    : 'number';
type InputDimension<M, K extends PropertyKey> = M extends { inputDimensions: infer Dimensions }
    ? K extends keyof Dimensions ? Dimensions[K] extends SignalDimension ? Dimensions[K] : 'unknown' : 'unknown'
    : 'unknown';
type NumericInput<Dimension extends SignalDimension> = Dimension extends 'unknown'
    ? number | NumericTyped
    : CompatibleNumeric<Dimension>;
type InputExpression<M, K extends PropertyKey> = InputDeclaredType<M, K> extends 'boolean'
    ? BooleanExpr
    : NumericInput<InputDimension<M, K>>;

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
        SignalRef<`${ID}.${K & string}`, OutputValue<M, K>, OutputUnit<M, K>, OutputDimension<M, K>>;
};
type Options<M extends {
    inputs: object;
    parameters: object;
}> = {
    system: string;
    at: Layout;
    inputs?: Partial<{ [K in keyof M['inputs']]: InputExpression<M, K> }>;
    parameters?: Partial<Record<keyof M['parameters'], number>>;
    history?: Record<string, HistoryPolicy>;
};
/** Runtime metadata supplies validation and editor completion, including external installed models. */
export function simulation<const ID extends string, K extends keyof ModelCatalog>(name: ID, kind: K, options: Options<ModelCatalog[K]>): SimRef<ModelCatalog[K], ID, K & string> {
    const spec = model(kind);
    for (const [input, value] of Object.entries(options.inputs ?? {})) {
        const actual = expressionInfo(value);
        if (!actual) continue;
        const expectedType = spec.inputTypes?.[input] ?? 'number';
        const expectedDimension = spec.inputDimensions?.[input] ?? 'unknown';
        if (actual.type !== expectedType)
            failDiagnostic('SATURN_TYPE_VALUE', 'typing.valueTypeMismatch', { model: String(kind), input, expected: expectedType, actual: actual.type }, { model: String(kind), input, expectedType, actualType: actual.type });
        if (expectedDimension !== 'unknown' && actual.dimension !== 'unknown' && actual.dimension !== expectedDimension)
            failDiagnostic('SATURN_TYPE_DIMENSION', 'typing.dimensionMismatch', { model: String(kind), input, expected: expectedDimension, actual: actual.dimension }, { model: String(kind), input, expectedDimension, actualDimension: actual.dimension });
    }
    const node: Simulation = { id: id(name), model: kind, system: options.system, parameters: { ...Object.fromEntries(Object.entries(spec.parameters).map(([k, v]) => [k, v.default])), ...options.parameters }, inputs: { ...spec.inputs, ...options.inputs }, layout: options.at, ...(options.history ? { history: options.history } : {}) };
    const ports = physicalTypes().includes(spec.visual) ? portRefs(node.id as ID, spec.visual as VisualOf<ModelCatalog[K]>) : {} as PortsOf<ModelCatalog[K],ID>;
    return Object.assign(
        { id: node.id as ID, kind: String(kind), ports, [simulationValue]: node },
        Object.fromEntries(Object.entries(spec.outputs).map(([k, unit]) => [k, createSignalRef(`${name}.${k}`, outputType(spec, k), unit, spec.outputDimensions?.[k] ?? 'unknown')])),
    ) as SimRef<ModelCatalog[K], ID, K & string>;
}
export type DerivedRef<ID extends string = string, Unit extends string = string, Dimension extends SignalDimension = 'unknown'> = Derived & {
    readonly value: SignalRef<ID, number, Unit, Dimension>;
};
export function derived<const ID extends string, const Unit extends string = 'отн.', const E extends NumericTyped | number = NumericTyped | number>(
    name: ID,
    expression: E,
    unit?: Unit,
    history?: HistoryPolicy,
): DerivedRef<ID, Unit, E extends NumericTyped ? DimensionOf<E> : 'scalar'> {
    const resolvedUnit = (unit ?? 'отн.') as Unit;
    const dimension = (typeof expression === 'number' ? 'scalar' : 'unknown') as E extends NumericTyped ? DimensionOf<E> : 'scalar';
    const result: Derived = { id: id(name), expression: expression as Expr, unit: resolvedUnit, ...(history ? { history } : {}) };
    Object.defineProperty(result, 'value', { value: createSignalRef(name, 'number', resolvedUnit, dimension), enumerable: false });
    return result as DerivedRef<ID, Unit, E extends NumericTyped ? DimensionOf<E> : 'scalar'>;
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
type NumericSignalKey<T> = {
    [K in keyof T]: T[K] extends SignalRef<string, number, string, SignalDimension> ? K : never
}[keyof T] & string;
export function aggregate<T extends SimRef, K extends NumericSignalKey<T>>(
    items: T[],
    output: K,
    method: 'mean' | 'sum' | 'min' | 'max' = 'mean',
): OperationExpr<number, SignalDimensionOf<T[K]>> {
    if (!Array.isArray(items) || !items.length || items.length > 256)
        throw new AppError('Aggregate needs a bounded non-empty equipment list');
    const args = items.map(item => { const node = item[simulationValue]; if (!model(node.model).outputs[output])
        throw new AppError(`Unknown aggregate output: ${output}`); return signal(`${node.id}.${output}`); });
    return operation(method === 'mean' ? 'div' : method === 'sum' ? 'add' : method, method === 'mean' ? [operationNode('add', args), args.length] : args) as OperationExpr<number, SignalDimensionOf<T[K]>>;
}
const operationNode = (op: OperationExpr<number, SignalDimension>['op'], args: Expr[]): OperationExpr<number, SignalDimension> => operation(op, args);

export type ControllerRef<ID extends string = string, O extends Record<string, Expr> = {}> = {
    readonly id: ID;
    readonly profile: 'saturn-fbd';
    readonly ports: PortRefs<'saturn',ID>;
    readonly inputs: { readonly [K in keyof typeof inputPins & string]: SignalRef<`${ID}.${K}`, number, ''> };
    readonly healthy: SignalRef<`${ID}.healthy`, boolean, 'лог.', 'boolean'>;
    readonly powered: SignalRef<`${ID}.powered`, boolean, 'лог.', 'boolean'>;
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
   healthy:createSignalRef(`${name}.healthy`,'boolean','лог.','boolean'),
   powered:createSignalRef(`${name}.powered`,'boolean','лог.','boolean'),
   [controllerValue]:controller,
 },Object.fromEntries(Object.keys(options.outputs).map(k=>[k,createSignalRef(`${name}.${k}`,'number','')]))) as ControllerRef<ID,O>;
}
export const pin=<const ID extends string>(name:ID):SignalRef<ID,number,'','unknown'>=>createSignalRef(id(name) as ID,'number','','unknown');
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
export const block=<const ID extends string>(name:ID):SignalRef<ID,number,'','unknown'>=>createSignalRef(id(name) as ID,'number','','unknown');
export const functionBlock=(type:PlcBlock['type'],inputs:Expr[],params:number[]=[]):PlcBlock=>({type,inputs,params});

/** Shared report/live-HMI blueprint; binding environments are explicit at each use. */
export const view=(name:string,options:Omit<Presentation,'id'>):Presentation=>({id:id(name),...options});
export const panel=(children:ViewNode[],direction:'row'|'column'='column',title?:string):ViewNode=>({kind:'group',children,direction,...(title?{title}:{})});
export const label=(text:string):ViewNode=>({kind:'text',text});
export const readout=(label:string,binding:string,unit='',digits=2):ViewNode=>({kind:'value',label,binding,unit,digits});
export const dataTable=(columns:Extract<ViewNode,{kind:'table'}>['columns']):ViewNode=>({kind:'table',columns});
export const trend=(title:string,x:string,y:string):ViewNode=>({kind:'chart',title,x,y});
export const commandButton=(label:string,target:string,value:number):ViewNode=>({kind:'action',label,target,value});
