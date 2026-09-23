/** Renderer-independent Saturn element contract.
 *
 * One semantic element owns canonical spatial geometry. 2D engineering layouts,
 * catalog previews and HMI representations are projections of that model; standard
 * engineering glyphs stay a separate semantic identity, not screenshots of 3D.
 */
export type Vec3 = readonly [number, number, number];
export type Quaternion = readonly [number, number, number, number];
export type Quality = 'good' | 'stale' | 'bad' | 'offline';
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
  /** Projection visibility. Missing means visible. */
  visible?: Partial<Record<'spatial3d' | 'scada2d' | 'hmi' | 'catalog', boolean>>;
}
export interface FluidZoneDefinition {
  id: string;
  medium: string;
  role: 'contained' | 'flow' | 'surface';
  /** Signal driving level/flow when applicable. */
  signal?: string;
}
export interface ElementVisualIdentity {
  /** Stable engineering glyph ID used in catalog/tree/navigation. */
  glyph: string;
  category: ElementCategory;
  /** Stable canonical geometry family. Vendor variants may share a glyph. */
  geometry: string;
  envelope: GeometryEnvelope;
  materials?: readonly string[];
  parts?: readonly SemanticPart[];
  fluids?: readonly FluidZoneDefinition[];
}
export interface ComponentDefinition {
  type: string;
  version: number;
  label: string;
  parameters: Readonly<Record<string, Parameter>>;
  signals: Readonly<Record<string, { unit: string; meaning: string }>>;
  ports: (parameters: Readonly<Record<string, number>>) => readonly Port[];
  references: readonly string[];
  visual: ElementVisualIdentity;
}
export interface Asset {
  id: string;
  type: string;
  parameters: Readonly<Record<string, number>>;
  /** Metres; right-handed Z-up. */
  pose3D: Pose;
  /** Authored diagram placement. Shape/ports are derived from the canonical element. */
  layout2D: { x: number; y: number; rotation: number };
}
export interface Projection2D {
  width: number;
  height: number;
  ports: Readonly<Record<string, { x: number; y: number; direction: 'left' | 'right' | 'up' | 'down'; role: Port['role'] }>>;
}

function params(definition: ComponentDefinition, overrides: Readonly<Record<string, number>> = {}): Record<string, number> {
  const values: Record<string, number> = {};
  for (const key of Object.keys(overrides)) if (!(key in definition.parameters)) throw new Error(`Unknown parameter: ${key}`);
  for (const [key, field] of Object.entries(definition.parameters)) {
    const value = overrides[key] ?? field.default;
    if (!Number.isFinite(value) || value < field.min || value > field.max) throw new Error(`Invalid ${key}: ${value}`);
    values[key] = value;
  }
  return values;
}

/** Derive 2D connector anchors from canonical 3D port position + normal.
 * Geometry may simplify, but topology and port orientation stay canonical.
 */
export function deriveSchematicProjection(
  definition: ComponentDefinition,
  overrides: Readonly<Record<string, number>>,
  size: { width: number; height: number; padding?: number },
): Projection2D {
  const p = params(definition, overrides), ports = definition.ports(p), pad = size.padding ?? 0;
  const { min, max } = definition.visual.envelope;
  const spanX = Math.max(1e-9, max[0] - min[0]), spanZ = Math.max(1e-9, max[2] - min[2]);
  const result: Record<string, Projection2D['ports'][string]> = {};
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

export interface ElementPack {
  id: string;
  version: string;
  title: string;
  elements: readonly ComponentDefinition[];
}
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
  register(definition: ComponentDefinition) {
    if (this.definitions.has(definition.type)) throw new Error(`Duplicate component: ${definition.type}`);
    this.definitions.set(definition.type, definition);
    return this;
  }
  registerPack(pack: ElementPack) { for (const definition of defineElementPack(pack).elements) this.register(definition); return this; }
  get(type: string) {
    const result = this.definitions.get(type);
    if (!result) throw new Error(`Unknown component: ${type}`);
    return result;
  }
  has(type: string) { return this.definitions.has(type); }
  list() { return [...this.definitions.values()]; }
  create(type: string, id: string, overrides: Record<string, number> = {}): Asset {
    const definition = this.get(type), parameters = params(definition, overrides);
    return { id, type, parameters, pose3D: { position: [0, 0, 0], rotation: [0, 0, 0, 1] }, layout2D: { x: 0, y: 0, rotation: 0 } };
  }
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
