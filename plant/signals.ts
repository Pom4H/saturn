import { id, signalInfo, signalRef, type Expr, type SignalDimension, type SignalRef } from './types';

export type SignalAccess = 'read' | 'write' | 'read-write';
export type SignalValue =
  | number | boolean | string | bigint | Date | Uint8Array
  | readonly number[] | readonly boolean[] | readonly string[]
  | Readonly<Record<string, unknown>>;

export type ValueKind = 'number' | 'boolean' | 'string' | 'bigint' | 'datetime' | 'bytes' | 'number[]' | 'boolean[]' | 'string[]' | 'struct';

export interface SignalQuality {
  validity: 'good' | 'uncertain' | 'bad';
  connection: 'online' | 'offline';
  freshness: 'fresh' | 'stale';
  substituted?: boolean;
  simulated?: boolean;
  overridden?: boolean;
  reason?: string;
}

export interface SignalSample<T extends SignalValue = SignalValue> {
  value: T | null;
  timestamp: number;
  receivedAt: number;
  sequence?: number;
  quality: SignalQuality;
}

export type SignalOrigin =
  | { kind: 'hardware'; device: string; channel?: string }
  | { kind: 'protocol'; protocol: string; endpoint: string; address?: string }
  | { kind: 'derived'; dependencies: readonly string[]; expression?: Expr }
  | { kind: 'aggregate'; dependencies: readonly string[]; window: number; operation: 'sum'|'avg'|'min'|'max'|'last'|'integral' }
  | { kind: 'simulation'; model: string }
  | { kind: 'replay'; runId?: string }
  | { kind: 'manual'; actor?: string }
  | { kind: 'estimated'; model?: string };

export interface SignalBinding {
  protocol: string;
  endpoint: string;
  address?: string;
  codec?: string;
  pollInterval?: number;
  metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface SignalDefinition<T extends SignalValue = SignalValue, A extends SignalAccess = SignalAccess> {
  readonly id: string;
  readonly kind: ValueKind;
  readonly access: A;
  readonly unit?: string;
  readonly dimension?: SignalDimension;
  readonly label?: string;
  readonly description?: string;
  readonly range?: readonly [number, number];
  readonly enum?: readonly string[];
  readonly origin: SignalOrigin;
  readonly binding?: SignalBinding;
}

export interface Signal<T extends SignalValue = SignalValue, A extends SignalAccess = SignalAccess> {
  readonly definition: SignalDefinition<T, A>;
  readonly ref?: SignalRef<string, number | boolean | string, string, SignalDimension>;
}

export const quality = {
  good: (): SignalQuality => ({ validity:'good', connection:'online', freshness:'fresh' }),
  uncertain: (reason?: string): SignalQuality => ({ validity:'uncertain', connection:'online', freshness:'fresh', ...(reason?{reason}:{}) }),
  bad: (reason: string): SignalQuality => ({ validity:'bad', connection:'online', freshness:'fresh', reason }),
  stale: (reason?: string): SignalQuality => ({ validity:'uncertain', connection:'online', freshness:'stale', ...(reason?{reason}:{}) }),
  offline: (reason?: string): SignalQuality => ({ validity:'bad', connection:'offline', freshness:'stale', ...(reason?{reason}:{}) }),
} as const;

type ScalarKind = 'number'|'boolean'|'string';
type ScalarFor<K extends ScalarKind> = K extends 'number' ? number : K extends 'boolean' ? boolean : string;
type ScalarOptions<K extends ScalarKind, A extends SignalAccess> =
  Omit<SignalDefinition<ScalarFor<K>, A>, 'id'|'kind'|'access'|'origin'> & { access?: A; origin?: SignalOrigin };

function scalar<const ID extends string, const K extends ScalarKind, const A extends SignalAccess = 'read'>(
  name: ID, kind: K, options: ScalarOptions<K,A> = {} as ScalarOptions<K,A>,
): Signal<ScalarFor<K>, A> {
  const unit = options.unit ?? '';
  const dimension = options.dimension ?? (kind === 'boolean' ? 'boolean' : 'unknown');
  return {
    definition: { id:id(name), kind, access:(options.access ?? 'read') as A, origin:options.origin ?? {kind:'manual'}, ...options, unit, dimension },
    ref: signalRef(name, kind, unit, dimension) as SignalRef<string, ScalarFor<K>, string, SignalDimension>,
  };
}

type ComplexOptions<T extends SignalValue, A extends SignalAccess> =
  Omit<SignalDefinition<T,A>, 'id'|'kind'|'access'|'origin'> & { access?: A; origin?: SignalOrigin };

function complex<const ID extends string, T extends SignalValue, A extends SignalAccess = 'read'>(
  name: ID, kind: Exclude<ValueKind, ScalarKind>, options: ComplexOptions<T,A> = {} as ComplexOptions<T,A>,
): Signal<T,A> {
  return { definition:{ id:id(name), kind, access:(options.access ?? 'read') as A, origin:options.origin ?? {kind:'manual'}, ...options } };
}

export const signal = {
  number: <const ID extends string, const A extends SignalAccess = 'read'>(name:ID, options?: ScalarOptions<'number',A>) => scalar<ID,'number',A>(name,'number',options),
  boolean: <const ID extends string, const A extends SignalAccess = 'read'>(name:ID, options?: ScalarOptions<'boolean',A>) => scalar<ID,'boolean',A>(name,'boolean',options),
  string: <const ID extends string, const A extends SignalAccess = 'read'>(name:ID, options?: ScalarOptions<'string',A>) => scalar<ID,'string',A>(name,'string',options),
  bigint: <const ID extends string>(name:ID, options?: ComplexOptions<bigint,'read'>) => complex<ID,bigint>(name,'bigint',options),
  datetime: <const ID extends string>(name:ID, options?: ComplexOptions<Date,'read'>) => complex<ID,Date>(name,'datetime',options),
  bytes: <const ID extends string>(name:ID, options?: ComplexOptions<Uint8Array,'read'>) => complex<ID,Uint8Array>(name,'bytes',options),
  numbers: <const ID extends string>(name:ID, options?: ComplexOptions<readonly number[],'read'>) => complex<ID,readonly number[]>(name,'number[]',options),
  booleans: <const ID extends string>(name:ID, options?: ComplexOptions<readonly boolean[],'read'>) => complex<ID,readonly boolean[]>(name,'boolean[]',options),
  strings: <const ID extends string>(name:ID, options?: ComplexOptions<readonly string[],'read'>) => complex<ID,readonly string[]>(name,'string[]',options),
  struct: <T extends Readonly<Record<string, unknown>>, const ID extends string>(name:ID, options?: ComplexOptions<T,'read'>) => complex<ID,T>(name,'struct',options),
} as const;

export function bind<T extends SignalValue, A extends SignalAccess>(source: Signal<T,A>, binding: SignalBinding): Signal<T,A> {
  return { ...source, definition:{...source.definition, binding, origin:{kind:'protocol',protocol:binding.protocol,endpoint:binding.endpoint,address:binding.address}} };
}

export const protocols = {
  modbus: (endpoint:string, address:number|string, options:Omit<SignalBinding,'protocol'|'endpoint'|'address'>={}):SignalBinding => ({protocol:'modbus',endpoint,address:String(address),...options}),
  opcua: (endpoint:string, nodeId:string, options:Omit<SignalBinding,'protocol'|'endpoint'|'address'>={}):SignalBinding => ({protocol:'opcua',endpoint,address:nodeId,...options}),
  mqtt: (endpoint:string, topic:string, options:Omit<SignalBinding,'protocol'|'endpoint'|'address'>={}):SignalBinding => ({protocol:'mqtt',endpoint,address:topic,...options}),
  generic: (protocol:string, endpoint:string, address?:string, options:Omit<SignalBinding,'protocol'|'endpoint'|'address'>={}):SignalBinding => ({protocol,endpoint,...(address?{address}:{}),...options}),
} as const;

export function derived<T extends number|boolean|string>(
  output: Signal<T>, dependencies: readonly Signal<number|boolean|string>[], expression: Expr,
): Signal<T> {
  return { ...output, definition:{...output.definition, origin:{kind:'derived',dependencies:dependencies.map(s=>s.definition.id),expression}} };
}

export function aggregate(
  output: Signal<number>, input: Signal<number>, operation: Extract<SignalOrigin,{kind:'aggregate'}>['operation'], window: number,
): Signal<number> {
  if (!Number.isFinite(window) || window <= 0) throw new Error('Signal aggregate window must be positive');
  return { ...output, definition:{...output.definition, origin:{kind:'aggregate',dependencies:[input.definition.id],window,operation}} };
}

export function replay<T extends SignalValue>(source: Signal<T>, runId?: string): Signal<T> {
  return { ...source, definition:{...source.definition, origin:{kind:'replay',...(runId?{runId}:{})}} };
}

export class SignalCatalog {
  private readonly items = new Map<string,Signal>();
  add(...signals: readonly Signal[]): this {
    for (const s of signals) {
      if (this.items.has(s.definition.id)) throw new Error('Duplicate signal: ' + s.definition.id);
      this.items.set(s.definition.id,s);
    }
    return this;
  }
  get(name:string):Signal|undefined { return this.items.get(name); }
  list():readonly Signal[] { return [...this.items.values()]; }
}

export function fromRef(
  ref: SignalRef<string, number|boolean|string, string, SignalDimension>,
  options: Partial<Omit<SignalDefinition,'id'|'kind'|'unit'|'dimension'|'origin'>> & { origin?: SignalOrigin } = {},
): Signal<number|boolean|string> {
  const info=signalInfo(ref);
  return { ref, definition:{id:ref.ref,kind:info.type,unit:info.unit,dimension:info.dimension,access:'read',origin:options.origin??{kind:'derived',dependencies:[]},...options} };
}
