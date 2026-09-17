import { registerComponent, catalog, type Equipment, type Scene } from '../src/core';
import { registerSvgRenderer, register3dRenderer, el, type SvgRendererContext } from '../src/view';
import type { RuntimeFrame } from '../src/runtime/protocol';
import { models } from './models';
import { evaluate } from './kernel';
import type { Project, Frame, Expr } from './types';
const metalStroke = '#526f7a', water = '#10a6b5', fuel = '#d39b51';
type Draw = (c: SvgRendererContext) => void;
const body = (c: SvgRendererContext, x = 15, y = 10, w = 120, h = 66) => el(c.root, 'rect', { x, y, width: w, height: h, rx: 8, fill: c.paint('metal'), stroke: metalStroke, 'stroke-width': 2 });
const shaft = (c: SvgRendererContext) => el(c.root, 'path', { d: 'M0 49H25 M125 49H150', stroke: metalStroke, 'stroke-width': 12, fill: 'none' });
const rotor = (c: SvgRendererContext, key: string) => { const g = el(c.root, 'g'); for (let i = 0; i < 6; i++)
    el(g, 'path', { d: 'M0 0 Q20 -14 26 0 L7 6Z', fill: '#385866', transform: `rotate(${i * 60})` }); el(g, 'circle', { r: 7, fill: '#cad9dd', stroke: metalStroke }); c.onUpdate(dt => { g.setAttribute('transform', `translate(75 45) rotate(${c.phase('rotor', (c.number(key, dt) ?? 0) * .3, dt) % 360})`); }); };
const shapes: Record<string, Draw> = {
    pump: c => { shaft(c); el(c.root, 'path', { d: 'M48 80H103L112 94H37Z', fill: c.paint('dark') }); el(c.root, 'circle', { cx: 75, cy: 45, r: 37, fill: c.paint('metal'), stroke: metalStroke, 'stroke-width': 3 }); el(c.root, 'circle', { cx: 75, cy: 45, r: 28, fill: '#e8f2f3', stroke: metalStroke }); rotor(c, 'rpm'); },
    turbine: c => { shaft(c); body(c, 23, 7, 105, 75); el(c.root, 'circle', { cx: 75, cy: 45, r: 32, fill: '#dfebed', stroke: metalStroke }); rotor(c, 'rpm'); },
    reactor: c => { body(c, 28, 4, 96, 82); el(c.root, 'ellipse', { cx: 76, cy: 8, rx: 48, ry: 10, fill: c.paint('metal'), stroke: metalStroke }); for (let i = 0; i < 7; i++)
        el(c.root, 'rect', { x: 43 + i * 9, y: 20, width: 5, height: 50, rx: 2, fill: fuel }); el(c.root, 'path', { d: 'M0 68H28 M124 28H150', fill: 'none', stroke: water, 'stroke-width': 9 }); },
    channel: c => { el(c.root, 'rect', { x: 24, y: 16, width: 110, height: 50, rx: 23, fill: c.paint('metal'), stroke: metalStroke, 'stroke-width': 2 }); el(c.root, 'rect', { x: 36, y: 23, width: 85, height: 36, rx: 15, fill: '#daeaf0' }); for (let i = 0; i < 4; i++)
        el(c.root, 'path', { d: `M44 ${30 + i * 8}H114`, stroke: fuel, 'stroke-width': 5 }); shaft(c); const damage = el(c.root, 'path', { d: 'M64 14L74 26L66 40L87 55L78 68', fill: 'none', stroke: '#bf4b40', 'stroke-width': 4, opacity: 0 }); c.onUpdate(() => damage.setAttribute('opacity', String(c.signal('damage')?.value ?? 0))); },
    separator: c => { body(c, 10, 10, 130, 67); el(c.root, 'rect', { x: 16, y: 43, width: 117, height: 27, rx: 9, fill: water, opacity: .55 }); el(c.root, 'path', { d: 'M45 78V92 M106 78V92', stroke: metalStroke, 'stroke-width': 8 }); },
    exchanger: c => { body(c, 12, 8, 126, 72); for (let i = 0; i < 10; i++)
        el(c.root, 'path', { d: `M${24 + i * 11} 14V72`, stroke: '#477b87', 'stroke-width': 3 }); el(c.root, 'path', { d: 'M0 20H12 M138 65H150', stroke: water, 'stroke-width': 9 }); },
    generator: c => { body(c, 15, 8, 120, 70); el(c.root, 'circle', { cx: 75, cy: 44, r: 25, fill: '#eaf2f4', stroke: metalStroke }); el(c.root, 'path', { d: 'M54 44Q63 15 75 44T96 44', stroke: water, 'stroke-width': 4, fill: 'none' }); },
    control: c => { body(c, 24, 5, 102, 78); for (let i = 0; i < 3; i++)
        el(c.root, 'rect', { x: 35 + i * 29, y: 19, width: 18, height: 14, fill: '#2d5564' }); el(c.root, 'path', { d: 'M43 61H106', stroke: '#3a6674', 'stroke-width': 5 }); const indicator = el(c.root, 'circle', { cx: 75, cy: 57, r: 8, fill: water }); c.onUpdate(() => indicator.setAttribute('fill', (c.number('trip') ?? 0) > .5 ? '#c45544' : water)); },
    sensor: c => { el(c.root, 'path', { d: 'M75 68V93', stroke: metalStroke, 'stroke-width': 8 }); el(c.root, 'circle', { cx: 75, cy: 38, r: 34, fill: c.paint('metal'), stroke: metalStroke, 'stroke-width': 3 }); el(c.root, 'circle', { cx: 75, cy: 38, r: 27, fill: '#f1f7f8' }); const needle = el(c.root, 'path', { d: 'M75 38L75 15', stroke: '#315b6e', 'stroke-width': 3 }); c.onUpdate(dt => needle.setAttribute('transform', `rotate(${Math.max(-100, Math.min(100, (c.number('value', dt) ?? 0) * 50 - 60))} 75 38)`)); },
    structure: c => { el(c.root, 'path', { d: 'M12 92V26L75 1L138 26V92Z', fill: c.paint('metal'), stroke: metalStroke, 'stroke-width': 3 }); for (let i = 0; i < 4; i++)
        el(c.root, 'rect', { x: 24 + i * 28, y: 37, width: 18, height: 38, fill: '#486b77' }); },
};
const installed = new Set<string>();
export function installEquipment() {
    for (const spec of models()) {
        const kind = `plant_${spec.visual}`;
        if (installed.has(kind))
            continue;
        installed.add(kind);
        if (!catalog[kind])
            registerComponent(kind, { version: '1.0.0', label: spec.title, width: 150, height: 118, fields: { x: { label: 'X', scope: 'layout', default: 0 }, y: { label: 'Y', scope: 'layout', default: 0 } }, ports: {}, signals: Object.fromEntries(Object.entries(spec.outputs).map(([k, unit]) => [k, { label: k, unit, type: 'number' }])) });
        registerSvgRenderer(kind, c => { (shapes[spec.visual] ?? shapes.sensor)(c); const key = Object.keys(spec.outputs)[0]; const text = el(c.root, 'text', { x: 75, y: 111, 'text-anchor': 'middle', 'font-family': 'ui-monospace,monospace', 'font-size': 15, fill: '#214d5f' }); c.onUpdate(dt => { const value = c.number(key, dt); text.textContent = value === null ? '—' : `${value.toFixed(2)} ${spec.outputs[key]}`; }); });
        register3dRenderer(kind, c => { const T = c.THREE, root = new T.Group(), round = ['pump', 'turbine', 'reactor', 'channel', 'separator'].includes(spec.visual); const mesh = new T.Mesh(round ? new T.CylinderGeometry(.4, .4, .7, 20) : new T.BoxGeometry(.8, .7, .5), c.materials.steel); root.add(mesh); return { root, ports: new Map(), update: () => { }, dispose() { mesh.geometry.dispose(); } }; });
    }
}
export function references(expr: Expr): string[] { return typeof expr === 'object' ? 'ref' in expr ? [expr.ref] : expr.args.flatMap(references) : []; }
export function sceneFor(project: Project, system: string): Scene {
    const visible = new Set([system]);
    let added = true;
    while (added) {
        added = false;
        for (const group of project.systems)
            if (group.parent && visible.has(group.parent) && !visible.has(group.id)) {
                visible.add(group.id);
                added = true;
            }
    }
    return { nodes: project.devices.filter(n => visible.has(n.system)).map((n): Equipment => ({ id: n.id, kind: `plant_${n.type}`, variable: n.id, props: { ...n.layout, quality: 'good', alarm: 'none' } })), links: [] };
}
export function visualFrame(project: Project, frame: Frame): RuntimeFrame {
    const equipment: RuntimeFrame['equipment'] = {};
    const derived = new Map(project.signals.map(s => [s.id, s.expression]));
    const expand = (expr: Expr): string[] => references(expr).flatMap(ref => derived.has(ref) ? expand(derived.get(ref)!) : [ref]);
    const active = project.alarms.filter(rule => frame.alarms.some(state => state.id === rule.id && state.active));
    for (const n of project.devices) {
        const signals: RuntimeFrame['equipment'][string]['signals'] = {};
        for (const [key, expr] of Object.entries(n.signals)) {
            const s = evaluate(expr, id => frame.samples[id] ?? { value: null, time: frame.time, quality: 'bad' }, frame.time);
            signals[key] = { type: 'number', value: s.value, quality: s.quality, timestamp: s.time, unit: catalog[`plant_${n.type}`]?.signals?.[key]?.unit ?? 'отн.' };
        }
        const own = new Set(Object.values(n.signals).flatMap(expand));
        const relevant = active.filter(rule => expand(rule.signal).some(ref => own.has(ref)));
        const alarm = relevant.some(rule => rule.priority === 'critical') ? 'trip' : relevant.length ? 'warning' : 'none';
        equipment[n.id] = { positionId: n.id, instanceId: `${frame.runId}:${n.id}`, facts: { mode: frame.paused ? 'paused' : 'simulation', alarm }, signals };
    }
    return { runId: frame.runId, seq: frame.seq, simTimeMs: frame.time, type: 'snapshot', timestamp: frame.time, equipment, flows: {}, events: [] };
}
