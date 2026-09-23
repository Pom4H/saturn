/** Declarative scene projection and factories. Equipment metadata lives in one registry. */
import type { RuntimeConfig } from './runtime/protocol';
import { registry as componentRegistry } from './elements/core-elements';
import type { Point, Direction, Value } from './elements/model';
import type { Quality, Alarm } from './observation';
export { componentRegistry };
export { defineSchematicElement } from './elements/model';
export type { Point, Direction, Value, Field, CommandDefinition, SignalDefinition, SchematicPort, ComponentProjection } from './elements/model';
export type { Quality, Alarm } from './observation';
export type Kind = string;
export interface Equipment { id: string; kind: Kind; props: Record<string, Value>; variable: string; tap?: string }
export interface Endpoint { node: string; port: string }
export interface Link { id: string; from: Endpoint; to: Endpoint; variable?: string }
/** Derived grouping underlay; never equipment, a signal source or runtime state. */
export interface SceneGroup { id: string; title: string; parent?: string; depth: number; x: number; y: number; width: number; height: number; count: number }
export interface SceneConnection {id:string;medium:'pipe'|'power'|'control'|'bus';from:{device:string;port:string};to:{device:string;port:string};points:{x:number;y:number;z:number}[];valid:boolean;error?:string}
export interface Scene { connections?:SceneConnection[]; nodes: Equipment[]; links: Link[]; groups?: SceneGroup[] }
export const directionVector: Record<Direction, Point> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } };
export function defaults(kind: Kind): Record<string, Value> { return Object.fromEntries(Object.entries(componentRegistry.schematic(kind).fields).map(([key, f]) => [key, f.default])); }
export function worldPort(node: Equipment, port: string): Point & { direction: Direction } {
  const p = componentRegistry.schematic(node.kind).ports[port];
  if (!p) throw new Error(`У ${node.id} нет порта ${port}`);
  return { x: Number(node.props.x) + p.x, y: Number(node.props.y) + p.y, direction: p.direction };
}
// The same calls also work in ordinary TypeScript outside the playground.
type Base = { x: number; y: number; quality?: Quality; alarm?: Alarm };
type InPort = Endpoint & { readonly role: 'in' };
type OutPort = Endpoint & { readonly role: 'out' };
type Inline = Equipment & { inlet: InPort; outlet: OutPort };
function create<T extends Equipment = Equipment>(kind: Kind, id: string, props: object): T {
  if (!componentRegistry.hasSchematic(kind)) throw new Error(`Unknown component: ${kind}`);
  const node: Equipment & Record<string, unknown> = { kind, id, variable: '', props: { ...defaults(kind), ...props } };
  for (const [name, port] of Object.entries(componentRegistry.schematic(kind).ports)) node[name] = { node: id, port: name, role: port.role };
  return node as unknown as T;
}
/** Generic factory for any installed component, including independent packages. */
export const component = (kind: string, id: string, props: Record<string, Value>) => create(kind, id, props);
/** Declarative data only. Connecting is an explicit browser operation. */
export const runtime = (configuration: RuntimeConfig): RuntimeConfig => ({ ...configuration });
export const tank = (id: string, props: Base & { level?: number }) => create<Equipment & { outlet: OutPort }>('tank', id, props);
export const pump = (id: string, props: Base & { rpm?: number; temperature?: number; vibration?: number; nominalFlow?: number; degradationRate?: number; startDelay?: number; maintenanceSeconds?: number }) => create<Inline>('pump', id, props);
export const valve = (id: string, props: Base & { opening?: number }) => create<Inline>('valve', id, props);
export const flowmeter = (id: string, props: Base) => create<Inline>('flowmeter', id, props);
export const exchanger = (id: string, props: Base & { temperature?: number }) => create<Inline>('exchanger', id, props);
export const outlet = (id: string, props: Base) => create<Equipment & { inlet: InPort }>('outlet', id, props);
export const pressure = (id: string, props: { value?: number; at?: number; offset?: number; quality?: Quality; alarm?: Alarm }) => create<Equipment>('pressure', id, props);
export const temperature = (id: string, props: { value?: number; at?: number; offset?: number; quality?: Quality; alarm?: Alarm }) => create<Equipment>('temperature', id, props);
export const connect = (from: OutPort, to: InPort): Link => ({ id: `${from.node}.${from.port}:${to.node}.${to.port}`, from, to });
export const tap = (line: Link, instrument: Equipment): Equipment => ({ ...instrument, tap: line.id });

/** Trusted extension-authoring API. The bounded project compiler intentionally
 * does not expose these functions to declarative project source. */
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
export { materialPresets, mediumPresets, materialCssColor, mediumCssColor, type MaterialPreset, type MediumPreset } from './elements/materials';
