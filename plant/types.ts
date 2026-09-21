import type { Presentation } from './presentation';
import type { Controller, ControllerState } from './controller';
import type { Connection, Attachment } from './ports';
import type { HmiDrawCommand } from './vendor/saturn/src/runtime';
/** Portable contracts. No DOM, Node, filesystem, SQL driver or network imports. */
export type Scalar = number | boolean | string;
export type Quality = 'good' | 'bad' | 'stale' | 'offline';

declare const signalValueType: unique symbol;
declare const expressionValueType: unique symbol;
export type SignalRuntimeType = 'number' | 'boolean' | 'string';
export type SignalDimension = 'unknown' | 'scalar' | 'boolean' | 'voltage' | 'current' | 'power' | 'energy' | 'flow' | 'volume' | 'pressure' | 'temperature' | 'resistance' | 'rotational-speed' | 'ratio' | 'frequency' | 'time' | (string & {});
export type SignalValueForRuntime<Type extends SignalRuntimeType> = Type extends 'boolean' ? boolean : Type extends 'string' ? string : number;
export interface RefExpr { readonly ref: string }
export interface SignalRef<ID extends string = string, Value extends Scalar = number, Unit extends string = string, Dimension extends SignalDimension = 'unknown'> extends RefExpr {
    readonly ref: ID;
    readonly [signalValueType]: { value: Value; unit: Unit; dimension: Dimension };
}
export interface RuntimeOperationExpr {
    readonly op: 'add' | 'mul' | 'sub' | 'div' | 'min' | 'max' | 'gt' | 'lt' | 'not' | 'and';
    readonly args: Expr[];
}
export interface OperationExpr<Value extends Scalar = number, Dimension extends SignalDimension = 'unknown'> extends RuntimeOperationExpr {
    readonly [expressionValueType]: { value: Value; dimension: Dimension };
}
export type SignalId<S> = S extends SignalRef<infer ID, Scalar, string, SignalDimension> ? ID : never;
export type SignalValueOf<S> = S extends SignalRef<string, infer Value, string, SignalDimension> ? Value : never;
export type SignalUnitOf<S> = S extends SignalRef<string, Scalar, infer Unit, SignalDimension> ? Unit : never;
export type SignalDimensionOf<S> = S extends SignalRef<string, Scalar, string, infer Dimension> ? Dimension : never;
export type ExpressionDimensionOf<E> = E extends SignalRef<string, Scalar, string, infer Dimension> ? Dimension : E extends OperationExpr<Scalar, infer Dimension> ? Dimension : 'unknown';
export type ExpressionValueOf<E> = E extends SignalRef<string, infer Value, string, SignalDimension> ? Value : E extends OperationExpr<infer Value, SignalDimension> ? Value : E extends number ? number : E extends boolean ? boolean : never;
export interface SignalMetadata { type: SignalRuntimeType; unit: string; dimension: SignalDimension }
export const signalMetadata = Symbol('saturn.signal.metadata');
export function signalRef<const ID extends string, const Type extends SignalRuntimeType, const Unit extends string, const Dimension extends SignalDimension = 'unknown'>(ref: ID, type: Type, unit: Unit, dimension?: Dimension): SignalRef<ID, SignalValueForRuntime<Type>, Unit, Dimension> {
    const value = { ref };
    Object.defineProperty(value, signalMetadata, { value: { type, unit, dimension: dimension ?? 'unknown' }, enumerable: false, configurable: false, writable: false });
    return value as unknown as SignalRef<ID, SignalValueForRuntime<Type>, Unit, Dimension>;
}
export function signalInfo(ref: SignalRef<string, Scalar, string, SignalDimension>): SignalMetadata {
    return (ref as SignalRef<string, Scalar, string, SignalDimension> & { [signalMetadata]?: SignalMetadata })[signalMetadata] ?? { type: 'number', unit: '', dimension: 'unknown' };
}

export type Expr<Value extends Scalar = Scalar, Dimension extends SignalDimension = 'unknown'> =
    | number
    | boolean
    | RefExpr
    | RuntimeOperationExpr
    | OperationExpr<Value, Dimension>;
export interface Sample {
    value: number | null;
    quality: Quality;
    time: number;
}
export interface System {
    id: string;
    title: string;
    parent?: string;
}
export interface Layout {
    x: number;
    y: number;
}
export interface Simulation {
    id: string;
    model: string;
    system: string;
    parameters: Record<string, number>;
    inputs: Record<string, Expr>;
    layout: Layout;
    history?: Record<string, HistoryPolicy>;
}
export interface Derived {
    id: string;
    expression: Expr;
    unit: string;
    history?: HistoryPolicy;
}
export interface Device {
    id: string;
    type: string;
    system: string;
    layout: Layout;
    signals: Record<string, Expr>;
}
export interface HistoryPolicy {
    deadband: number;
    maxInterval: number;
    retention: number;
}
export interface AlarmRule {
    id: string;
    title: string;
    signal: Expr;
    above: number;
    clearBelow: number;
    delay: number;
    priority: 'warning' | 'critical';
    notify: boolean;
}
export interface AlarmState {
    id: string;
    active: boolean;
    acknowledged: boolean;
    pendingSince: number | null;
    raisedAt: number | null;
    clearedAt: number | null;
    acknowledgedAt: number | null;
    actor: string | null;
    quality: Quality;
    episode: number;
}
export interface ReportInput {
    type: 'number';
    default: number;
    min: number;
    max: number;
}
export type ReportValueType = 'number' | 'boolean' | 'string' | 'datetime';
export interface ReportField {
    key: string;
    type: ReportValueType;
    unit?: string;
}
export interface ExcelColumnSpec {
    key: string;
    title: string;
    unit?: string;
    format?: string;
    width?: number;
}
export interface ExcelSortSpec { key: string; direction: 'asc' | 'desc' }
export interface ExcelSheetSpec {
    name: string;
    columns: ExcelColumnSpec[];
    sort?: ExcelSortSpec[];
    freezeRows?: number;
    autoFilter?: boolean;
}
export interface ExcelWorkbookSpec { sheets: ExcelSheetSpec[] }

export interface Report {
    view?: Presentation;
    id: string;
    title: string;
    on: {
        workflow_dispatch?: {
            inputs?: Record<string, ReportInput>;
        };
        schedule?: {
            cron: string;
        }[];
    };
    signals: string[];
    sql: string;
    window: number;
    columns: {
        key: string;
        title: string;
        unit?: string;
    }[];
    schema?: ReportField[];
    excel?: ExcelWorkbookSpec;
    chart?: {
        x: string;
        y: string;
        title: string;
    };
    notify: boolean;
}
/** Operator setpoints are signals, not edits to model coefficients. */
export interface Control {
    id: string;
    title: string;
    system: string;
    unit: string;
    min: number;
    max: number;
    initial: number;
    rate: number;
    step: number;
    enableWhen?: Expr;
    safeValue?: number;
    blockedReason?: string;
}
export interface ControlState { requested: number; value: number; blocked: boolean }
export interface Project {
    views?: Presentation[];
    controllers?: Controller[];
    connections?: Connection[];
    attachments?: Attachment[];
    version: 1;
    id: string;
    title: string;
    description: string;
    systems: System[];
    controls?: Control[];
    simulations: Simulation[];
    signals: Derived[];
    devices: Device[];
    alarms: AlarmRule[];
    reports: Report[];
    stepMs: number;
    history: HistoryPolicy;
    seed: number;
    overview?: {
        signal: string;
        label: string;
        unit: string;
        alarmAbove?: number;
    }[];
}
export interface ModelSpec {
    kind: string;
    version: string;
    title: string;
    visual: string;
    inputs: Record<string, number>;
    parameters: Record<string, {
        default: number;
        min: number;
        max: number;
    }>;
    outputs: Record<string, string>;
    inputTypes?: Record<string, SignalRuntimeType>;
    inputDimensions?: Record<string, SignalDimension>;
    outputTypes?: Record<string, SignalRuntimeType>;
    outputDimensions?: Record<string, SignalDimension>;
    initialize(p: Readonly<Record<string, number>>): Record<string, number>;
    advance(s: Readonly<Record<string, number>>, inputs: Readonly<Record<string, number>>, p: Readonly<Record<string, number>>, dt: number): Record<string, number>;
    observe(s: Readonly<Record<string, number>>, p: Readonly<Record<string, number>>): Record<string, number>;
}
export interface Checkpoint {
    plc?: Record<string,ControllerState>;
    controllerAbi?: string;
    runId: string;
    revision: string;
    seq: number;
    time: number;
    epoch: number;
    states: Record<string, Record<string, number>>;
    overrides: Record<string, number>;
    controls?: Record<string, ControlState>;
    paused: boolean;
    modelVersions: Record<string, string>;
    invalidModels?: string[];
}
export interface Frame {
    displays?: Record<string,HmiDrawCommand[]>;
    runId: string;
    revision: string;
    seq: number;
    time: number;
    paused: boolean;
    synthetic: true;
    samples: Record<string, Sample>;
    alarms: AlarmState[];
}
export interface Event {
    id: string;
    runId: string;
    time: number;
    type: string;
    subject: string;
    actor?: string;
    detail: string;
}
export interface Revision {
    id: string;
    parent: string | null;
    time: number;
    actor: string;
    message: string;
    files: Record<string, string>;
}
export interface Repository {
    head(): Promise<string | null>;
    desired(): Promise<string | null>;
    publish(id: string, expected: string | null): Promise<void>;
    read(id: string): Promise<Revision>;
    log(limit?: number): Promise<Revision[]>;
    commit(files: Record<string, string>, expected: string | null, message: string, actor: string): Promise<Revision>;
    /** Optional source refresh for filesystem/Git-backed workspaces. */
    refresh?(): Promise<void>;
}
export interface SqlDatabase {
    exec(sql: string, bind?: unknown[] | Record<string, unknown>): void;
    all<T = Record<string, unknown>>(sql: string, bind?: unknown[] | Record<string, unknown>): T[];
    transaction<T>(fn: () => T): T;
    close(): void;
}
export interface ReportData {
    samples: {
        signal: string;
        time: number;
        value: number | null;
        quality: string;
    }[];
    segments: {
        signal: string;
        start: number;
        end: number;
        value: number | null;
        quality: string;
    }[];
}
export interface ReportTask {
    id: string;
    report: Report;
    revision: string;
    runId: string;
    trigger: string;
    actor: string;
    createdAt: number;
    from: number;
    to: number;
    inputs: Record<string, number>;
    data: ReportData;
}
export interface ReportArtifact {
    html: string;
    rows: Record<string, unknown>[];
}
export interface Actor {
    id: string;
    role: 'viewer' | 'operator' | 'engineer';
}
export class AppError extends Error {
    constructor(message: string, public status = 400) { super(message); }
}
export const clone = <T>(v: T): T => structuredClone(v);
export function finite(v: unknown, name: string, min = -1e12, max = 1e12): number {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
        throw new AppError(`${name}: expected ${min}..${max}`);
    return v;
}
export const id = (v: unknown): string => {
    if (typeof v !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,95}$/.test(v) || /(?:__proto__|constructor|prototype)/.test(v))
        throw new AppError('Invalid identifier');
    return v;
};
export function requireRole(actor: Actor, role: Actor['role']): void {
    const ranks = { viewer: 0, operator: 1, engineer: 2 };
    if (!(actor.role in ranks) || ranks[actor.role] < ranks[role])
        throw new AppError('Insufficient permission', 403);
}
