/** Renderer-facing scene IR and visual metadata registry.
 *
 * This module is deliberately not an authoring DSL. Saturn projects are authored
 * only through @saturn/core and compiled by plant/compiler.ts.
 */
import type { Signal } from './runtime/protocol';
import type { ElementVisualIdentity } from './elements/model';

export type Point = { x: number; y: number };
export type Direction = 'left' | 'right' | 'up' | 'down';
export type Kind = string;
export type Value = string | number | boolean;

export interface Field {
  scope?: 'layout' | 'behavior';
  label: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  choices?: readonly string[];
  default: Value;
}
export interface PortSpec extends Point { direction: Direction; role: 'in' | 'out' }
export interface CommandDefinition {
  label: string;
  valueType?: 'number' | 'boolean' | 'string';
  min?: number;
  max?: number;
  choices?: readonly string[];
}
export interface SignalDefinition { label: string; type: Signal['type']; unit: string }
export interface Definition {
  label: string;
  width: number;
  height: number;
  fields: Record<string, Field>;
  ports: Record<string, PortSpec>;
  instrument?: boolean;
  version?: string;
  prefix?: string;
  signals?: Record<string, SignalDefinition>;
  commands?: Record<string, CommandDefinition>;
  visual?: ElementVisualIdentity;
}

/** Installed presentation metadata. plant/equipment.ts is the canonical installer. */
export const catalog: Record<Kind, Definition> = Object.create(null);

export function registerComponent(kind: string, definition: Definition): void {
  if (!/^[a-z][a-zA-Z0-9_]{0,47}$/.test(kind) || ['__proto__', 'prototype', 'constructor'].includes(kind))
    throw new Error(`Invalid component type: ${kind}`);
  if (Object.hasOwn(catalog, kind))
    throw new Error(`Duplicate component type: ${kind}`);
  if (!(Number.isFinite(definition.width) && definition.width > 0 &&
        Number.isFinite(definition.height) && definition.height > 0) || !definition.version)
    throw new Error('A component needs dimensions and a version');
  if (definition.visual && (!/^[a-z][a-z0-9_.-]+$/i.test(definition.visual.glyph) || !definition.visual.geometry))
    throw new Error('Invalid component visual identity');
  for (const name of [
    ...Object.keys(definition.fields),
    ...Object.keys(definition.ports),
    ...Object.keys(definition.signals ?? {}),
    ...Object.keys(definition.commands ?? {}),
  ]) if (['__proto__', 'prototype', 'constructor'].includes(name))
    throw new Error(`Invalid member: ${name}`);
  catalog[kind] = definition;
}

export interface Equipment {
  id: string;
  kind: Kind;
  props: Record<string, Value>;
  variable: string;
  tap?: string;
}
export interface Endpoint { node: string; port: string }

/** Renderer-local edge shape. Authored physical topology uses SceneConnection. */
export interface Link { id: string; from: Endpoint; to: Endpoint; variable?: string }

export interface SceneGroup {
  id: string;
  title: string;
  parent?: string;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
  count: number;
}
export interface SceneConnection {
  id: string;
  medium: 'pipe' | 'power' | 'control' | 'bus';
  from: { device: string; port: string };
  to: { device: string; port: string };
  points: { x: number; y: number; z: number }[];
  valid: boolean;
  error?: string;
}
export interface Scene {
  connections?: SceneConnection[];
  nodes: Equipment[];
  links: Link[];
  groups?: SceneGroup[];
}

export const directionVector: Record<Direction, Point> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

export function worldPort(node: Equipment, port: string): Point & { direction: Direction } {
  const definition = catalog[node.kind];
  const p = definition?.ports[port];
  if (!p) throw new Error(`У ${node.id} нет порта ${port}`);
  return {
    x: Number(node.props.x) + p.x,
    y: Number(node.props.y) + p.y,
    direction: p.direction,
  };
}

export {
  ComponentRegistry as ElementRegistry,
  defineElementPack,
  deriveSchematicProjection,
  type ComponentDefinition as ElementDefinition,
  type ElementPack,
  type ElementVisualIdentity,
  type FluidZoneDefinition,
  type SemanticPart,
} from './elements/model';
export { registerGlyph, getGlyph, listGlyphs, type GlyphDefinition } from './elements/symbols';
export {
  materialPresets,
  mediumPresets,
  materialCssColor,
  mediumCssColor,
  type MaterialPreset,
  type MediumPreset,
} from './elements/materials';
