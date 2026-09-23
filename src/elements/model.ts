/** One equipment definition. Schematic metadata is a projection, not a second registry. */
import type { Quality } from '../observation';
export type { Quality } from '../observation';
export type Vec3 = readonly [number, number, number];
export type Quaternion = readonly [number, number, number, number];
export type Point = { x: number; y: number };
export type Direction = 'left' | 'right' | 'up' | 'down';
export type Value = string | number | boolean;
export interface Field { scope?: 'layout' | 'behavior'; label: string; min?: number; max?: number; step?: number; unit?: string; choices?: readonly string[]; default: Value }
export interface CommandDefinition { label: string; valueType?: 'number' | 'boolean' | 'string'; min?: number; max?: number; choices?: readonly string[] }
export interface SignalDefinition { label: string; type: 'number' | 'boolean' | 'string'; unit: string }
export interface Sample { value: number | null; unit: string; timestamp: number; quality: Quality }
export type Signals = Readonly<Record<string, Sample>>;
export interface Pose { position: Vec3; rotation: Quaternion }
export interface Port { id: string; position: Vec3; normal: Vec3; medium: string; role: 'in' | 'out' | 'bidirectional' }
export interface Parameter { default: number; min: number; max: number; unit: string }
export type ElementCategory = 'process' | 'instrumentation' | 'electrical' | 'mechanical' | 'control' | 'structure' | 'generic';
export type SemanticPartRole = 'body' | 'port' | 'actuator' | 'sensor' | 'medium' | 'support' | 'rotor' | 'display';
export interface GeometryEnvelope { min: Vec3; max: Vec3 }
export interface SemanticPart {
  id: string;
  role: SemanticPartRole;
  importance: number;
  visible?: Partial<Record<'spatial3d' | 'scada2d' | 'hmi' | 'catalog', boolean>>;
}
export interface FluidZoneDefinition { id: string; medium: string; role: 'contained' | 'flow' | 'surface'; signal?: string }
export interface ElementVisualIdentity {
  glyph: string;
  category: ElementCategory;
  geometry: string;
  envelope: GeometryEnvelope;
  materials?: readonly string[];
  parts?: readonly SemanticPart[];
  fluids?: readonly FluidZoneDefinition[];
}
export interface SchematicPort extends Point { direction: Direction; role: Port['role'] }
/** An authored glyph may place an anchor differently from a front-view projection.
 * It references a canonical port; its role and direction are never re-declared. */
export interface SchematicSpec {
  kind: string;
  width: number;
  height: number;
  fields: Readonly<Record<string, Field>>;
  anchors?: Readonly<Record<string, { port: string; at?: Point }>>;
  instrument?: boolean;
  prefix?: string;
}
export interface ComponentDefinition {
  type: string;
  version: number | string;
  label: string;
  parameters: Readonly<Record<string, Parameter>>;
  signals: Readonly<Record<string, { unit: string; meaning?: string; label?: string; type?: SignalDefinition['type'] }>>;
  ports: (parameters: Readonly<Record<string, number>>) => readonly Port[];
  references: readonly string[];
  visual: ElementVisualIdentity;
  schematic?: SchematicSpec;
  commands?: Readonly<Record<string, CommandDefinition>>;
}
/** Read-only compatibility surface for the compiler, inspector and renderer.
 * Its values are derived from ComponentDefinition, never installed separately. */
export interface ComponentProjection {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly fields: Readonly<Record<string, Field>>;
  readonly ports: Readonly<Record<string, SchematicPort>>;
  readonly instrument?: boolean;
  readonly version: string;
  readonly prefix?: string;
  readonly signals: Readonly<Record<string, SignalDefinition>>;
  readonly commands?: Readonly<Record<string, CommandDefinition>>;
  readonly visual: ElementVisualIdentity;
}
export interface Asset {
  id: string;
  type: string;
  parameters: Readonly<Record<string, number>>;
  /** Metres; right-handed Z-up. */
  pose3D: Pose;
  layout2D: { x: number; y: number; rotation: number };
}
export interface Projection2D {
  width: number;
  height: number;
  ports: Readonly<Record<string, SchematicPort>>;
}
const has = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const unsafe = (key: string) => ['__proto__', 'prototype', 'constructor'].includes(key);
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function params(definition: ComponentDefinition, overrides: Readonly<Record<string, number>> = {}): Record<string, number> {
  const values: Record<string, number> = {};
  for (const key of Object.keys(overrides)) if (!has(definition.parameters, key)) throw new Error(`Unknown parameter: ${key}`);
  for (const [key, field] of Object.entries(definition.parameters)) {
    const value = overrides[key] ?? field.default;
    if (!Number.isFinite(value) || value < field.min || value > field.max) throw new Error(`Invalid ${key}: ${value}`);
    values[key] = value;
  }
  return values;
}
export function deriveSchematicProjection(
  definition: ComponentDefinition,
  overrides: Readonly<Record<string, number>>,
  size: { width: number; height: number; padding?: number },
): Projection2D {
  const ports = definition.ports(params(definition, overrides)), pad = size.padding ?? 0;
  const { min, max } = definition.visual.envelope;
  const spanX = Math.max(1e-9, max[0] - min[0]), spanZ = Math.max(1e-9, max[2] - min[2]);
  const result: Record<string, SchematicPort> = {};
  for (const port of ports) {
    const ax = pad + (port.position[0] - min[0]) / spanX * Math.max(1, size.width - pad * 2);
    const ay = pad + (max[2] - port.position[2]) / spanZ * Math.max(1, size.height - pad * 2);
    const [nx, , nz] = port.normal;
    const horizontal = Math.abs(nx) >= Math.abs(nz);
    const direction = horizontal ? nx < 0 ? 'left' : 'right' : nz > 0 ? 'up' : 'down';
    const x = direction === 'left' ? 0 : direction === 'right' ? size.width : Math.max(0, Math.min(size.width, ax));
    const y = direction === 'up' ? 0 : direction === 'down' ? size.height : Math.max(0, Math.min(size.height, ay));
    result[port.id] = { x, y, direction, role: port.role };
  }
  return { width: size.width, height: size.height, ports: result };
}
export interface ElementPack { id: string; version: string; title: string; elements: readonly ComponentDefinition[] }
export function defineElementPack(pack: ElementPack): ElementPack {
  if (!/^@[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(pack.id) || !/^\d+\.\d+\.\d+/.test(pack.version) || !pack.title.trim()) throw new Error('Invalid Saturn element pack');
  const types = new Set<string>();
  for (const element of pack.elements) {
    if (!/^[a-z][a-z0-9_.-]+$/i.test(element.type) || types.has(element.type)) throw new Error(`Invalid or duplicate element type: ${element.type}`);
    if (!element.visual?.glyph || !element.visual?.geometry) throw new Error(`Element ${element.type} needs glyph and canonical geometry`);
    types.add(element.type);
  }
  return pack;
}
export class ComponentRegistry {
  private definitions = new Map<string, ComponentDefinition>();
  private projections = new WeakMap<ComponentDefinition, ComponentProjection>();
  register(definition: ComponentDefinition) {
    if (!/^[a-z][a-z0-9_.-]+$/i.test(definition.type) || unsafe(definition.type)) throw new Error(`Invalid component: ${definition.type}`);
    if (this.has(definition.type)) throw new Error(`Duplicate component: ${definition.type}`);
    if (!definition.version || !definition.visual?.glyph || !definition.visual.geometry) throw new Error('A component needs a version and visual identity');
    for (const key of [...Object.keys(definition.parameters), ...Object.keys(definition.signals), ...Object.keys(definition.commands ?? {}), ...Object.keys(definition.schematic?.fields ?? {})]) if (unsafe(key)) throw new Error(`Invalid member: ${key}`);
    const s = definition.schematic;
    if (s) {
      if (!/^[a-z][a-zA-Z0-9_]{0,47}$/.test(s.kind) || unsafe(s.kind) || ['component', 'runtime', 'connect', 'tap'].includes(s.kind)) throw new Error(`Invalid component type: ${s.kind}`);
      if (this.has(s.kind)) throw new Error(`Duplicate component type: ${s.kind}`);
      if (![s.width, s.height].every(n => Number.isFinite(n) && n > 0)) throw new Error('A component needs positive dimensions');
      // Validate the projection before installing anything; no partial registry mutation.
      this.project(definition);
    }
    this.definitions.set(definition.type, freeze(definition));
    return this;
  }
  registerPack(pack: ElementPack) {
    // Preflight in an isolated index so a rejected pack cannot partially install.
    const checked = new ComponentRegistry();
    checked.definitions = new Map(this.definitions);
    for (const definition of defineElementPack(pack).elements) checked.register(definition);
    this.definitions = checked.definitions;
    return this;
  }
  private find(type: string) { return this.definitions.get(type) ?? [...this.definitions.values()].find(d => d.schematic?.kind === type); }
  get(type: string) {
    const definition = this.find(type);
    if (!definition) throw new Error(`Unknown component: ${type}`);
    return definition;
  }
  has(type: string) { return !!this.find(type); }
  list() { return [...this.definitions.values()]; }
  hasSchematic(kind: string) { return !!this.find(kind)?.schematic; }
  kinds() { return this.list().flatMap(d => d.schematic ? [d.schematic.kind] : []); }
  schematicEntries(): [string, ComponentProjection][] { return this.kinds().map(kind => [kind, this.schematic(kind)]); }
  findSchematic(kind: string): ComponentProjection | undefined { const d = this.find(kind); return d?.schematic ? this.project(d) : undefined; }
  schematic(kind: string): ComponentProjection {
    const projection = this.findSchematic(kind);
    if (!projection) throw new Error(`Unknown schematic component: ${kind}`);
    return projection;
  }
  private project(definition: ComponentDefinition): ComponentProjection {
    const cached = this.projections.get(definition);
    if (cached) return cached;
    const s = definition.schematic;
    if (!s) throw new Error(`No schematic projection: ${definition.type}`);
    const canonical = deriveSchematicProjection(definition, {}, s).ports;
    const ports: Record<string, SchematicPort> = {};
    const anchors: NonNullable<SchematicSpec['anchors']> = s.anchors ?? Object.fromEntries(Object.keys(canonical).map(port => [port, { port }]));
    for (const [name, anchor] of Object.entries(anchors)) {
      if (unsafe(name) || !has(canonical, anchor.port)) throw new Error(`Invalid schematic port: ${name} -> ${anchor.port}`);
      const port = canonical[anchor.port];
      if (anchor.at && ![anchor.at.x, anchor.at.y].every(Number.isFinite)) throw new Error(`Invalid anchor: ${name}`);
      ports[name] = { ...port, ...anchor.at };
    }
    const signals = Object.fromEntries(Object.entries(definition.signals).map(([key, signal]) => [key, { label: signal.label ?? key, type: signal.type ?? 'number', unit: signal.unit }]));
    const projection: ComponentProjection = freeze({ label: definition.label, version: String(definition.version), width: s.width, height: s.height, fields: s.fields, ports, signals, visual: definition.visual, ...(definition.commands ? { commands: definition.commands } : {}), ...(s.instrument ? { instrument: true } : {}), ...(s.prefix ? { prefix: s.prefix } : {}) });
    this.projections.set(definition, projection);
    return projection;
  }
  create(type: string, id: string, overrides: Record<string, number> = {}): Asset {
    const definition = this.get(type), parameters = params(definition, overrides);
    return { id, type: definition.type, parameters, pose3D: { position: [0, 0, 0], rotation: [0, 0, 0, 1] }, layout2D: { x: 0, y: 0, rotation: 0 } };
  }
}
/** Adapt a native schematic definition (for example generated PLC terminals) into
 * the same canonical contract. This function has no registry or other state. */
export function defineSchematicElement(kind: string, shape: {
  version: string; label: string; width: number; height: number;
  fields: Readonly<Record<string, Field>>;
  ports: Readonly<Record<string, SchematicPort>>;
  signals?: Readonly<Record<string, SignalDefinition>>;
  commands?: Readonly<Record<string, CommandDefinition>>;
  visual?: ElementVisualIdentity; instrument?: boolean; prefix?: string;
}): ComponentDefinition {
  const normals: Record<Direction, Vec3> = { left: [-1, 0, 0], right: [1, 0, 0], up: [0, 0, 1], down: [0, 0, -1] };
  const visual: ElementVisualIdentity = shape.visual ?? { glyph: 'generic.element', category: 'generic', geometry: kind, envelope: { min: [0, 0, 0], max: [shape.width / 100, .1, shape.height / 100] } };
  const canonicalPorts = freeze(Object.entries(shape.ports).map<Port>(([id, port]) => ({ id, position: [port.x / 100, 0, (shape.height - port.y) / 100], normal: normals[port.direction], medium: 'generic', role: port.role })));
  return {
    type: kind, version: shape.version, label: shape.label, parameters: {}, references: [], visual,
    signals: shape.signals ?? {}, ...(shape.commands ? { commands: shape.commands } : {}),
    ports: () => canonicalPorts,
    schematic: { kind, width: shape.width, height: shape.height, fields: shape.fields, anchors: Object.fromEntries(Object.entries(shape.ports).map(([name, p]) => [name, { port: name, at: { x: p.x, y: p.y } }])), ...(shape.instrument ? { instrument: true } : {}), ...(shape.prefix ? { prefix: shape.prefix } : {}) },
  };
}
export function rotate(v: Vec3, q: Quaternion): Vec3 {
  const [x, y, z, w] = q;
  if (Math.abs(Math.hypot(x, y, z, w) - 1) > 1e-8) throw new Error('Rotation must be a unit quaternion');
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}
export function worldPort(port: Port, pose: Pose): Port {
  const position = rotate(port.position, pose.rotation);
  return { ...port, position: position.map((x, i) => x + pose.position[i]) as unknown as Vec3, normal: rotate(port.normal, pose.rotation) };
}
export function readSignal(signals: Signals, key: string, unit: string): number | null {
  const sample = signals[key];
  return sample?.quality === 'good' && sample.unit === unit && sample.value !== null && Number.isFinite(sample.value) ? sample.value : null;
}
export function advancePhase(phase: number, cyclesPerSecond: number, dt: number): number {
  if (![phase, cyclesPerSecond, dt].every(Number.isFinite) || dt < 0) throw new Error('Invalid animation step');
  return ((phase + cyclesPerSecond * dt) % 1 + 1) % 1;
}
