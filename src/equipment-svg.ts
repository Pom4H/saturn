import { el } from './svg';
import type { SvgRendererContext } from './view';
import { materialCssColor, mediumCssColor } from './elements/materials';

// Original Saturn SVG anatomy, shared by the scene editor and canonical plant projection.
// These are representations only: observations and animation time are supplied by the host.
const medium2d = { water: mediumCssColor('water'), surface: materialCssColor('waterSurface'), highlight: materialCssColor('waterHighlight') };
const label = (g: SVGElement, x: number, y: number, text: string, size = 12, anchor = 'middle', color = '#38566a') => el(g, 'text', { x, y, fill: color, 'font-size': size, 'text-anchor': anchor, 'font-family': 'ui-monospace, SFMono-Regular, Consolas, monospace', 'font-weight': 600 }, text);
const part = (g: SVGElement, name: string) => el(g, 'g', { 'data-part': name });
const bolt = (g: SVGElement, x: number, y: number, r = 2) => { el(g, 'circle', { cx: x, cy: y, r, fill: '#78949f', stroke: '#eff6f7', 'stroke-width': .8 }); };
const rectFor = (c: SvgRendererContext) => (x: number, y: number, width: number, height: number, rx = 2, fill = c.paint('metal')) => el(c.root, 'rect', { x, y, width, height, rx, fill, stroke: '#718e9c', 'stroke-width': 1.4 });
let vesselId = 0;

/** Original SVG coordinates and materials are retained in every host, without per-symbol scaling. */
export function renderProcessSvg(kind: 'tank' | 'pump' | 'valve', c: SvgRendererContext, previewAlarmStops: () => boolean = () => false): void {
  const body = c.root, metal = c.paint('metal'), dark = c.paint('dark'), rect = rectFor(c);
  body.dataset.anatomy = `saturn-${kind}`;
    if (kind === 'tank') {
      el(body, 'ellipse', { cx: 79, cy: 226, rx: 67, ry: 4, fill: '#1c4055', opacity: .07 });
      rect(28, 193, 12, 31, 1, dark); rect(120, 193, 12, 31, 1, dark);
      rect(120, 172, 50, 24); rect(157, 167, 11, 34);
      el(body, 'path', { d: 'M18 42 C18 15 140 15 140 42V193C140 218 18 218 18 193Z', fill: '#e4f2f5', 'fill-opacity': .65, stroke: '#86a2ae', 'stroke-width': 2 });
      const clipId = `saturn-vessel-${++vesselId}`, defs = el(body, 'defs'), clip = el(defs, 'clipPath', { id: clipId });
      el(clip, 'path', { d: 'M23 45C23 24 135 24 135 45V192C135 211 23 211 23 192Z' });
      const water = el(body, 'g', { 'clip-path': `url(#${clipId})` });
      const fluid = el(water, 'rect', { x: 20, y: 90, width: 120, height: 125, fill: medium2d.water, opacity: .82, 'data-medium': 'water' });
      const surface = el(water, 'ellipse', { cx: 79, cy: 90, rx: 60, ry: 9, fill: medium2d.surface, stroke: medium2d.highlight, 'stroke-width': 1.2, 'data-medium-surface': 'water' });
      el(body, 'path', { d: 'M29 52V187M34 58V183', stroke: '#fff', 'stroke-width': 2.5, opacity: .5 });
      el(body, 'ellipse', { cx: 79, cy: 41, rx: 61, ry: 15, fill: metal, stroke: '#86a2ae', 'stroke-width': 1.5 });
      rect(68, 3, 23, 25, 1);
      const value = label(body, 79, 135, '', 22, 'middle', '#12475e');
      c.onUpdate(dt => { const v = c.number('level', dt), y = 195 - Math.max(0, Math.min(100, v ?? 0)) * 1.44; fluid.setAttribute('y', String(y)); fluid.setAttribute('height', String(215 - y)); surface.setAttribute('cy', String(y)); value.textContent = v === null ? '—' : `${Math.round(v)}%`; water.setAttribute('opacity', v === null ? '0' : '1'); });
    } else if (kind === 'pump') {
      el(body, 'ellipse', { cx: 118, cy: 160, rx: 95, ry: 5, fill: '#254e60', opacity: .07 });
      el(body, 'path', { d: 'M40 132 32 151H109L100 132M143 130 138 151H207L200 130', fill: dark, stroke: '#547685' });
      rect(25, 151, 190, 7); [34, 107, 142, 205].forEach(x => bolt(body, x, 154, 1.7));
      rect(0, 84, 40, 24); rect(0, 79, 10, 34); [84, 108].forEach(y => bolt(body, 5, y, 1.7));
      rect(64, 0, 24, 57); rect(58, 1, 36, 9); [64, 87].forEach(x => bolt(body, x, 5, 1.7));
      renderMotorAssembly(c);
      el(body, 'circle', { cx: 76, cy: 96, r: 48, fill: metal, stroke: '#7b97a3', 'stroke-width': 2 });
      el(body, 'circle', { cx: 76, cy: 96, r: 39, fill: dark, stroke: '#acbfc7', 'stroke-width': 3 });
      el(body, 'circle', { cx: 76, cy: 96, r: 32, fill: '#143e50', stroke: '#deedf1', 'stroke-width': 1.3 });
      const rotor = part(body, 'rotor');
      for (let angle = 0; angle < 360; angle += 72) el(rotor, 'path', { d: 'M76 91C83 87 96 86 101 75C105 89 94 101 82 104Z', transform: `rotate(${angle} 76 96)`, fill: metal, stroke: '#abc0c9', 'stroke-width': .65 });
      el(body, 'circle', { cx: 76, cy: 96, r: 8, fill: metal, stroke: '#718f9c' });
      for (let angle = 0; angle < 360; angle += 60) bolt(body, 76 + 43 * Math.cos(angle * Math.PI / 180), 96 + 43 * Math.sin(angle * Math.PI / 180), 2.3);
      const value = label(body, 171, 149, '', 9); const lamp = el(body, 'circle', { cx: 141, cy: 145, r: 2.4 });
      c.onUpdate(dt => {
        const rpm = c.number('rpm', dt), alarm = c.alarm(), stopped = (previewAlarmStops() && alarm === 'trip') || rpm === null || Math.abs(rpm) < 1;
        const angle = c.phase('rotor', stopped ? 0 : rpm / 10, dt);
        rotor.setAttribute('transform', `rotate(${angle % 360} 76 96)`); rotor.setAttribute('opacity', rpm === null ? '.3' : '1');
        rotor.dataset.rpm = rpm === null ? 'unknown' : String(rpm);
        value.textContent = alarm === 'trip' ? 'TRIP' : rpm === null ? 'НЕТ ДАННЫХ' : stopped ? 'СТОП' : 'РАБОТА';
        lamp.setAttribute('fill', alarm === 'trip' ? '#cd6152' : alarm === 'warning' ? '#b5822f' : rpm === null || stopped ? '#91a7af' : '#23a381');
      });
    } else if (kind === 'valve') {
      rect(0, 90, 160, 24); [7, 137].forEach(x => { rect(x, 81, 13, 42, 3); [88, 116].forEach(y => bolt(body, x + 6.5, y)); });
      el(body, 'path', { d: 'M43 88 62 72H98L119 88V116L98 132H62L43 116Z', fill: metal, stroke: '#6d8d9b', 'stroke-width': 1.4 });
      rect(57, 88, 46, 29, 6, '#0ca6c0');
      const gate = el(body, 'rect', { x: 59, y: 90, width: 42, height: 25, rx: 2, fill: metal, stroke: '#587d90', 'data-part': 'gate' });
      const stem = part(body, 'stem'); el(stem, 'rect', { x: 77, y: 40, width: 6, height: 42, rx: 1, fill: metal, stroke: '#66899c' });
      el(body, 'path', { d: 'M61 73V31H99V73M57 73H104', fill: 'none', stroke: '#5f7f8f', 'stroke-width': 4 });
      rect(51, 6, 58, 28, 6, dark); rect(60, 13, 40, 9, 2, '#9abcc9');
      const value = label(body, 80, 156, '', 14);
      c.onUpdate(dt => { const v = c.number('opening', dt), travel = Math.max(0, Math.min(100, v ?? 0)); gate.setAttribute('height', String(25 * (1 - travel / 100))); gate.setAttribute('opacity', travel > 99.9 ? '0' : '1'); stem.setAttribute('transform', `translate(0 ${-travel * .11})`); gate.setAttribute('visibility', v === null ? 'hidden' : 'visible'); stem.setAttribute('visibility', v === null ? 'hidden' : 'visible'); value.textContent = v === null ? '—' : `${Math.round(v)}%`; });
    }
}

/** Detailed motor, coupling, cooling fins and terminal box from the original pump SVG. */
export function renderMotorAssembly(c: SvgRendererContext): void {
  const body = c.root, dark = c.paint('dark'), rect = rectFor(c);
      rect(114, 82, 23, 26); rect(129, 57, 81, 77, 13, dark);
      for (let x = 141; x < 202; x += 7) { el(body, 'path', { d: `M${x} 65V126`, stroke: '#0b2c3c', 'stroke-width': 3.5 }); el(body, 'path', { d: `M${x + 1} 66V125`, stroke: '#65818e', 'stroke-width': 1 }); }
      rect(203, 66, 12, 60, 6, dark); rect(155, 40, 29, 21, 3, dark);
}
