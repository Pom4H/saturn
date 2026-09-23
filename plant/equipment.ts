import { terminals, footprint } from './ports';
import { routeConnections } from './routing';
import { renderSaturnPlcSvg } from './saturn-view';
import { drawHmiSvg, setDisplays } from './hmi-view';
import { groupLayout } from './group-layout';
import { createPlantModel } from './visual3d';
import { componentRegistry, defineSchematicElement, type Equipment, type Scene } from '../src/core';
import { registerSvgRenderer, register3dRenderer, el, type SvgRendererContext } from '../src/view';
import type { RuntimeFrame } from '../src/runtime/protocol';
import { models, outputType } from './models';
import { evaluate } from './kernel';
import type { Project, Frame, Expr, ModelSpec } from './types';
import { modelTitle } from './i18n';
import type { SaturnLocale } from './diagnostics';
import type { ElementCategory } from '../src/elements/model';
const metalStroke = '#526f7a', water = '#10a6b5', fuel = '#d39b51';
type Draw = (c: SvgRendererContext) => void;
const body = (c: SvgRendererContext, x = 15, y = 10, w = 120, h = 66) => el(c.root, 'rect', { x, y, width: w, height: h, rx: 8, fill: c.paint('metal'), stroke: metalStroke, 'stroke-width': 2 });
const shaft = (c: SvgRendererContext) => el(c.root, 'path', { d: 'M0 48H25 M125 48H150', stroke: metalStroke, 'stroke-width': 12, fill: 'none' });
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
    reservoir: c => { body(c, 32, 8, 86, 78); el(c.root, 'ellipse', { cx: 75, cy: 12, rx: 43, ry: 9, fill: c.paint('metal'), stroke: metalStroke });
        el(c.root, 'rect', { x: 48, y: 28, width: 54, height: 45, fill: '#314f60' });
        const level = el(c.root, 'rect', { x: 51, y: 32, width: 48, height: 38, fill: water, opacity: .7 });
        c.onUpdate(dt => { const v = c.number('level', dt); level.setAttribute('visibility', v === null ? 'hidden' : 'visible'); const h = Math.max(0, Math.min(1, (v ?? 0) / 100)) * 40; level.setAttribute('height', String(h)); level.setAttribute('y', String(72 - h)); }); },
    valve: c => { shaft(c); el(c.root, 'path', { d: 'M32 25L116 73V25L32 73Z', fill: c.paint('metal'), stroke: metalStroke, 'stroke-width': 2 });
        el(c.root, 'path', { d: 'M75 48V12', stroke: metalStroke, 'stroke-width': 5 });
        const lever = el(c.root, 'path', { d: 'M57 11H93', stroke: water, 'stroke-width': 6 });
        c.onUpdate(dt => { const v = c.number('opening', dt); lever.setAttribute('visibility', v === null ? 'hidden' : 'visible'); lever.setAttribute('transform', `rotate(${(v ?? 0) * .9} 75 11)`); }); },
    battery: c => { body(c, 27, 6, 98, 81); for (let i = 0; i < 3; i++) { el(c.root, 'rect', { x: 37, y: 16 + i * 21, width: 77, height: 15, fill: '#31566a' }); el(c.root, 'path', { d: `M99 ${20 + i * 21}v7 m-3 -3h6`, stroke: '#e2b67c', 'stroke-width': 2 }); }
        const charge = el(c.root, 'rect', { x: 38, y: 80, height: 3, width: 75, fill: water }); c.onUpdate(dt => { const v = c.number('charge', dt); charge.setAttribute('width', String(Math.max(0, Math.min(100, v ?? 0)) * .75)); }); },
    switchgear: c => { body(c, 22, 5, 106, 83); el(c.root, 'path', { d: 'M75 10V81', stroke: metalStroke });
        for (const x of [37, 88]) el(c.root, 'rect', { x, y: 18, width: 23, height: 14, fill: '#31566a' });
        const blade = el(c.root, 'path', { d: 'M44 67V47', stroke: water, 'stroke-width': 5 });
        el(c.root, 'circle', { cx: 99, cy: 57, r: 6, fill: '#e2b67c' });
        c.onUpdate(() => blade.setAttribute('transform', `rotate(${(c.number('closed') ?? 0) > .5 ? 0 : 45} 44 67)`)); },
    fan: c => { body(c, 27, 7, 97, 81); el(c.root, 'circle', { cx: 75, cy: 45, r: 34, fill: '#e8f2f3', stroke: metalStroke }); rotor(c, 'rpm'); },
    motor: c => { shaft(c); body(c, 25, 13, 100, 62); for (let i = 0; i < 9; i++)
        el(c.root, 'path', {d: `M${33 + 10*i} 21V68`, stroke: metalStroke, 'stroke-width': 2});
        el(c.root, 'rect', {x: 57, y: 5, width: 36, height: 14, fill: c.paint('dark')});
        el(c.root, 'path', {d: 'M35 77V90H120V77', stroke: metalStroke, 'stroke-width': 5, fill: 'none'}); },
    tower: c => { el(c.root, 'path', {d:'M25 18H125L118 76H32Z', fill:c.paint('metal'), stroke:metalStroke, 'stroke-width':2});
        el(c.root, 'rect', {x:19,y:78,width:113,height:13,rx:3,fill:water,opacity:.65});
        for(let i=0;i<5;i++) el(c.root,'path',{d:`M40 ${29+i*8}H109`,stroke:metalStroke,'stroke-width':3});
        el(c.root,'ellipse',{cx:75,cy:15,rx:32,ry:10,fill:c.paint('dark'),stroke:metalStroke});
        const fan=el(c.root,'path',{d:'M59 15H91 M75 8V22',stroke:water,'stroke-width':3});
        c.onUpdate(dt=>fan.setAttribute('transform',`rotate(${c.phase('rotor',(c.number('rpm',dt)??0)*.15,dt)%360} 75 15)`)); },
    filter: c => { shaft(c); el(c.root,'path',{d:'M38 26H112V60L99 82H65L51 57H38Z',fill:c.paint('metal'),stroke:metalStroke,'stroke-width':2});
        for(let i=0;i<6;i++) el(c.root,'path',{d:`M${55+i*7} 35l15 35`,stroke:metalStroke,'stroke-width':1.5});
        el(c.root,'rect',{x:72,y:80,width:24,height:10,fill:c.paint('dark')}); },
    checkvalve: c => { shaft(c); body(c,30,24,91,49); el(c.root,'path',{d:'M50 30L88 49L50 68Z M90 29V69',stroke:metalStroke,'stroke-width':3,fill:'#e1eff1'});
        const disc=el(c.root,'path',{d:'M89 28V67',stroke:water,'stroke-width':4});
        c.onUpdate(dt=>{const v=c.number('opening',dt);disc.setAttribute('visibility',v===null?'hidden':'visible');disc.setAttribute('transform',`rotate(${-(v??0)*.4} 89 28)`);}); },
    accumulator: c => { body(c,35,7,80,77); el(c.root,'ellipse',{cx:75,cy:9,rx:39,ry:8,fill:c.paint('metal'),stroke:metalStroke});
        const fluid=el(c.root,'rect',{x:43,y:47,width:64,height:29,rx:7,fill:water,opacity:.6});
        const diaphragm=el(c.root,'path',{d:'M43 45Q75 34 107 45',stroke:metalStroke,'stroke-width':3,fill:'none'});
        c.onUpdate(dt=>{const v=c.number('level',dt);fluid.setAttribute('visibility',v===null?'hidden':'visible');const h=(v??0)*.5;fluid.setAttribute('height',String(h));fluid.setAttribute('y',String(77-h));diaphragm.setAttribute('transform',`translate(0 ${32-h})`);});
        el(c.root,'path',{d:'M75 83V97',stroke:metalStroke,'stroke-width':8}); },
    relief: c => { el(c.root,'path',{d:'M75 96V55H141',stroke:metalStroke,'stroke-width':16,fill:'none'});
        body(c,51,19,48,52); el(c.root,'path',{d:'M58 25L90 31L58 37L90 43L59 50',stroke:metalStroke,'stroke-width':3,fill:'none'});
        el(c.root,'rect',{x:55,y:7,width:40,height:10,fill:c.paint('dark')});
        const spindle=el(c.root,'path',{d:'M75 35V69 M61 69H89',stroke:water,'stroke-width':4});
        c.onUpdate(dt=>{const v=c.number('opening',dt);spindle.setAttribute('visibility',v===null?'hidden':'visible');spindle.setAttribute('transform',`translate(0 ${-(v??0)*.1})`);}); },
    transformer: c => { body(c,34,29,84,54); for(const x of [45,75,105]) { el(c.root,'path',{d:`M${x} 29V9`,stroke:metalStroke,'stroke-width':5});
        for(let i=0;i<3;i++) el(c.root,'rect',{x:x-7,y:11+i*6,width:14,height:3,fill:'#d39b51'}); }
        for(let i=0;i<5;i++){el(c.root,'rect',{x:19,y:32+i*10,width:13,height:7,fill:c.paint('dark')});el(c.root,'rect',{x:120,y:32+i*10,width:13,height:7,fill:c.paint('dark')});}
        el(c.root,'path',{d:'M61 51l10 -8l-2 15h11l-9 13l1 -13h-11Z',fill:water}); },
    alternator: c => { shaft(c); body(c,25,12,101,68); el(c.root,'circle',{cx:75,cy:45,r:25,fill:'#dfebed',stroke:metalStroke});rotor(c,'rpm');
        el(c.root,'path',{d:'M42 80V92H111V80',stroke:metalStroke,'stroke-width':5,fill:'none'}); },
    calorimeter: c => { body(c,32,8,86,79); el(c.root,'ellipse',{cx:75,cy:12,rx:43,ry:10,fill:c.paint('metal'),stroke:metalStroke});
        el(c.root,'rect',{x:45,y:28,width:58,height:43,rx:5,fill:'#e4eff0',stroke:water,'stroke-width':3});
        el(c.root,'path',{d:'M55 34v31m13 -31v31m13 -31v31',stroke:fuel,'stroke-width':4});
        el(c.root,'path',{d:'M0 64H31 M118 34H150',stroke:water,'stroke-width':7,fill:'none'});
        const indicator=el(c.root,'rect',{x:95,y:57,width:4,height:8,fill:water});
        c.onUpdate(dt=>{const v=c.number('temperature',dt);indicator.setAttribute('visibility',v===null?'hidden':'visible');const h=Math.min(33,(v??0)*12);indicator.setAttribute('y',String(67-h));indicator.setAttribute('height',String(h));}); },
    structure: c => { el(c.root, 'path', { d: 'M12 92V26L75 1L138 26V92Z', fill: c.paint('metal'), stroke: metalStroke, 'stroke-width': 3 }); for (let i = 0; i < 4; i++)
        el(c.root, 'rect', { x: 24 + i * 28, y: 37, width: 18, height: 38, fill: '#486b77' }); },
};
export const svgVisualKinds = () => Object.keys(shapes);
Object.assign(shapes, {
 dcSupply:(c:SvgRendererContext)=>{body(c,26,12,100,75);el(c.root,'text',{x:76,y:52,'text-anchor':'middle',fill:metalStroke,'font-size':20},'24 V');for(let i=0;i<4;i++)el(c.root,'path',{d:`M38 ${64+i*4}h75`,stroke:metalStroke});},
 transmitter:(c:SvgRendererContext)=>{body(c,47,22,55,49);el(c.root,'circle',{cx:75,cy:45,r:18,fill:water,opacity:.4});el(c.root,'path',{d:'M75 72v19',stroke:metalStroke,'stroke-width':8});},
 contactor:(c:SvgRendererContext)=>{body(c,24,9,102,77);el(c.root,'path',{d:'M39 24v15h32V24 M100 20v20m0 20v20',stroke:metalStroke,'stroke-width':4,fill:'none'});const contact=el(c.root,'path',{d:'M100 40v20',stroke:water,'stroke-width':4});c.onUpdate(()=>contact.setAttribute('transform',`rotate(${(c.number('closed')??0)>.8?0:35} 100 40)`));},
 indicator:(c:SvgRendererContext)=>{body(c,34,18,81,65);const lamp=el(c.root,'circle',{cx:75,cy:48,r:23,fill:water,stroke:metalStroke,'stroke-width':5});c.onUpdate(()=>lamp.setAttribute('opacity',String(.2+.8*(c.number('brightness')??0))));},
 ioModule:(c:SvgRendererContext)=>{body(c,20,8,120,82);el(c.root,'text',{x:80,y:38,'font-size':16,'text-anchor':'middle',fill:metalStroke},'AI4');el(c.root,'text',{x:80,y:61,'font-size':10,'text-anchor':'middle',fill:metalStroke},'VIRTUAL');},
 junction:(c:SvgRendererContext)=>{el(c.root,'path',{d:'M0 48H150 M75 48V85',stroke:metalStroke,'stroke-width':17,fill:'none'});el(c.root,'path',{d:'M0 48H150 M75 48V85',stroke:'#c9e2e7','stroke-width':11,fill:'none'});},
 saturn:(c:SvgRendererContext)=>{const shell=el(c.root,'g',{});shell.innerHTML=renderSaturnPlcSvg({defsPrefix:'saturn-'+c.equipment.id});const svg=shell.querySelector('svg')!;svg.setAttribute('width','310');svg.setAttribute('height','170');const screen=svg.querySelector<SVGSVGElement>('.runtime-hmi')!;c.onUpdate(()=>drawHmiSvg(screen,c.equipment.id));},
});
const glyphByVisual:Record<string,string>={
 pump:'process.pump.centrifugal',turbine:'mechanical.rotating',reactor:'process.reactor',channel:'generic.element',separator:'process.tank.vertical',
 exchanger:'process.heat-exchanger',generator:'electrical.generator',control:'control.panel',sensor:'instrumentation.sensor',reservoir:'process.tank.vertical',
 valve:'process.valve.control',battery:'electrical.battery',switchgear:'control.panel',fan:'mechanical.rotating',motor:'electrical.motor',tower:'generic.element',
 filter:'process.filter.inline',checkvalve:'process.valve.control',accumulator:'process.tank.vertical',relief:'process.valve.control',transformer:'electrical.transformer',
 alternator:'electrical.generator',calorimeter:'instrumentation.sensor',dcSupply:'electrical.battery',transmitter:'instrumentation.sensor',contactor:'control.panel',
 indicator:'instrumentation.sensor',ioModule:'control.panel',junction:'generic.element',saturn:'control.panel'
};
const categoryByVisual=(visual:string):ElementCategory=>visual==='motor'||visual==='generator'||visual==='alternator'||visual==='transformer'||visual==='battery'||visual==='dcSupply'?'electrical'
  :visual==='sensor'||visual==='transmitter'||visual==='calorimeter'||visual==='indicator'?'instrumentation'
  :visual==='control'||visual==='switchgear'||visual==='contactor'||visual==='ioModule'||visual==='saturn'?'control'
  :visual==='turbine'||visual==='fan'?'mechanical':'process';

const installed = new Set<string>();
export function installEquipment(locale: SaturnLocale = 'en') {
    const specs: Array<Pick<ModelSpec,'kind'|'visual'|'titleKey'|'outputs'|'outputTypes'>> = [
        ...models(),
        {
            kind:'saturn-plc',
            visual:'saturn',
            titleKey:'model.saturn-plc',
            outputs:{healthy:'лог.',powered:'лог.'},
            outputTypes:{healthy:'boolean',powered:'boolean'},
        },
    ];
    for (const spec of specs) {
        if (!shapes[spec.visual]) throw new Error(`Missing SVG anatomy: ${spec.visual}`);
        const kind = `plant_${spec.visual}`;
        if (installed.has(kind))
            continue;
        installed.add(kind);
        if (!componentRegistry.findSchematic(kind))
            componentRegistry.register(defineSchematicElement(kind, { version: '1.0.0', label: modelTitle(spec.kind, locale), ...footprint(spec.visual), visual:{glyph:glyphByVisual[spec.visual]??'generic.element',category:categoryByVisual(spec.visual),geometry:`plant.${spec.visual}`,envelope:{min:[-.8,-.6,.02],max:[.8,.6,1.9]}}, fields: { x: { label: 'X', scope: 'layout', default: 0 }, y: { label: 'Y', scope: 'layout', default: 0 } }, ports: Object.fromEntries(Object.entries(terminals(spec.visual)).map(([name,t])=>[name,{x:t.x,y:t.y,direction:t.side,role:t.role==='source'?'out':'in'}])), signals: Object.fromEntries(Object.entries(spec.outputs).map(([k, unit]) => [k, { label: k, unit, type: outputType(spec, k) }])) }));
        registerSvgRenderer(kind, c => { shapes[spec.visual](c); if(spec.visual==='saturn')return; const key = Object.keys(spec.outputs)[0]; const text = el(c.root, 'text', { x: 75, y: 111, 'text-anchor': 'middle', 'font-family': 'ui-monospace,monospace', 'font-size': 15, fill: '#214d5f' }); c.onUpdate(dt => { const value = c.number(key, dt); text.textContent = value === null ? '—' : `${value.toFixed(2)} ${spec.outputs[key]}`; }); });
        register3dRenderer(kind, c => createPlantModel(c, spec.visual, Object.keys(spec.outputs)[0]));
    }
}
export function references(expr: Expr): string[] { return typeof expr === 'object' ? 'ref' in expr ? [expr.ref] : expr.args.flatMap(references) : []; }
/** One installation canvas. System selection changes the camera, never membership. */
export function sceneFor(project: Project): Scene {
    return {
        nodes: project.devices.map((n): Equipment => ({ id: n.id, kind: `plant_${n.type}`, variable: n.id, props: { ...n.layout, quality: 'good', alarm: 'none' } })),
        links: [],
        connections: routeConnections(project),
        groups: groupLayout(project, type => componentRegistry.schematic(`plant_${type}`)),
    };
}
export function visualFrame(project: Project, frame: Frame): RuntimeFrame {
    setDisplays(frame.displays??{},frame.time);
    const equipment: RuntimeFrame['equipment'] = {};
    const derived = new Map(project.signals.map(s => [s.id, s.expression]));
    const expand = (expr: Expr): string[] => references(expr).flatMap(ref => derived.has(ref) ? expand(derived.get(ref)!) : [ref]);
    const active = project.alarms.filter(rule => frame.alarms.some(state => state.id === rule.id && state.active));
    for (const n of project.devices) {
        const signals: RuntimeFrame['equipment'][string]['signals'] = {};
        for (const [key, expr] of Object.entries(n.signals)) {
            const s = evaluate(expr, id => frame.samples[id] ?? { value: null, time: frame.time, quality: 'bad' }, frame.time);
            const definition = componentRegistry.findSchematic(`plant_${n.type}`)?.signals?.[key];
            const common = { quality: s.quality, timestamp: s.time, unit: definition?.unit ?? 'отн.' };
            signals[key] = definition?.type === 'boolean'
                ? { type: 'boolean', value: s.value === null ? null : Boolean(s.value), ...common }
                : { type: 'number', value: s.value, ...common };
        }
        const own = new Set(Object.values(n.signals).flatMap(expand));
        const relevant = active.filter(rule => expand(rule.signal).some(ref => own.has(ref)));
        const alarm = relevant.some(rule => rule.priority === 'critical') ? 'trip' : relevant.length ? 'warning' : 'none';
        equipment[n.id] = { positionId: n.id, instanceId: `${frame.runId}:${n.id}`, facts: { mode: frame.paused ? 'paused' : 'simulation', alarm }, signals };
    }
    return { runId: frame.runId, seq: frame.seq, simTimeMs: frame.time, type: 'snapshot', timestamp: frame.time, equipment, flows: {}, events: [] };
}
