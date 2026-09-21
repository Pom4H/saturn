export type GlyphPrimitive =
  | { kind: 'path'; d: string; fill?: boolean }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill?: boolean }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx?: number; fill?: boolean }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number };

export interface GlyphDefinition {
  id: string;
  label: string;
  viewBox?: readonly [number, number, number, number];
  primitives: readonly GlyphPrimitive[];
}

const glyphs = new Map<string, GlyphDefinition>();
export function registerGlyph(definition: GlyphDefinition): void {
  if (!/^[a-z][a-z0-9_.-]+$/i.test(definition.id) || glyphs.has(definition.id) || !definition.primitives.length) throw new Error(`Invalid or duplicate Saturn glyph: ${definition.id}`);
  glyphs.set(definition.id, definition);
}
export function getGlyph(id: string): GlyphDefinition { return glyphs.get(id) ?? glyphs.get('generic.element')!; }
export function listGlyphs(): readonly GlyphDefinition[] { return [...glyphs.values()]; }

/** DOM renderer used by Shell/catalog. Paths are Saturn-authored engineering glyphs;
 * standard packs may register licensed/organization-specific notation separately.
 */
export function createGlyphSvg(document: Document, id: string, className = 'saturn-glyph'): SVGSVGElement {
  const NS='http://www.w3.org/2000/svg', definition=getGlyph(id), svg=document.createElementNS(NS,'svg');
  svg.setAttribute('viewBox',(definition.viewBox ?? [0,0,24,24]).join(' ')); svg.setAttribute('class',className); svg.setAttribute('aria-hidden','true');
  for (const primitive of definition.primitives) {
    const el=document.createElementNS(NS,primitive.kind==='line'?'line':primitive.kind);
    for (const [key,value] of Object.entries(primitive)) {
      if (key==='kind'||key==='fill') continue;
      el.setAttribute(key,String(value));
    }
    el.setAttribute('fill', primitive.fill ? 'currentColor' : 'none');
    el.setAttribute('stroke','currentColor'); el.setAttribute('stroke-width','1.6'); el.setAttribute('stroke-linecap','round'); el.setAttribute('stroke-linejoin','round');
    svg.append(el);
  }
  return svg;
}
const path=(d:string,fill=false):GlyphPrimitive=>({kind:'path',d,fill});
const circle=(cx:number,cy:number,r:number,fill=false):GlyphPrimitive=>({kind:'circle',cx,cy,r,fill});
const rect=(x:number,y:number,width:number,height:number,rx=0,fill=false):GlyphPrimitive=>({kind:'rect',x,y,width,height,rx,fill});
const line=(x1:number,y1:number,x2:number,y2:number):GlyphPrimitive=>({kind:'line',x1,y1,x2,y2});

[
 {id:'generic.element',label:'Equipment',primitives:[rect(5,5,14,14,2),line(2,12,5,12),line(19,12,22,12)]},
 {id:'process.pump.centrifugal',label:'Centrifugal pump',primitives:[circle(11,12,6),path('M8 8.5c4 0 7 2.5 7 6'),path('M17 12h5'),path('M11 6V2'),path('M7.5 18H16')]},
 {id:'process.tank.vertical',label:'Tank',primitives:[path('M6 5c0-2 12-2 12 0v14c0 2-12 2-12 0Z'),path('M6 5c0 2 12 2 12 0'),line(18,16,22,16)]},
 {id:'process.valve.control',label:'Control valve',primitives:[path('M4 9l8 6V9l-8 6Z'),path('M20 9l-8 6V9l8 6Z'),line(12,9,12,5),rect(9,2,6,3,1)]},
 {id:'instrumentation.flowmeter',label:'Flow meter',primitives:[line(2,12,6,12),circle(12,12,6),line(18,12,22,12),path('M9 12h6m-2-2 2 2-2 2')]},
 {id:'process.heat-exchanger',label:'Heat exchanger',primitives:[rect(5,4,14,16,3),path('M8 7v10m3-10v10m3-10v10m3-10v10'),line(2,8,5,8),line(19,16,22,16)]},
 {id:'process.filter.inline',label:'Filter',primitives:[line(2,12,6,12),path('M6 7h12l-3 10H9Z'),path('M9 8l5 8m-2-8 3 5'),line(18,12,22,12)]},
 {id:'process.outlet',label:'Process outlet',primitives:[line(2,12,16,12),path('m13 8 5 4-5 4')]},
 {id:'instrumentation.pressure',label:'Pressure',primitives:[circle(12,9,6),line(12,15,12,22),path('M12 9l3-3')]},
 {id:'instrumentation.temperature',label:'Temperature',primitives:[path('M10 4a2 2 0 0 1 4 0v10a4 4 0 1 1-4 0Z'),line(12,7,12,17)]},
 {id:'mechanical.rotating',label:'Rotating equipment',primitives:[circle(12,12,7),path('M12 5c4 4 4 10 0 14M5 12h14')]},
 {id:'electrical.motor',label:'Motor',primitives:[circle(12,12,7),path('M8 15V9l4 4 4-4v6')]},
 {id:'electrical.generator',label:'Generator',primitives:[circle(12,12,7),path('M8 12c1-4 3-4 4 0s3 4 4 0')]},
 {id:'electrical.transformer',label:'Transformer',primitives:[circle(9,12,5),circle(15,12,5)]},
 {id:'electrical.battery',label:'Battery',primitives:[line(7,5,7,19),line(10,8,10,16),line(15,5,15,19),line(18,8,18,16)]},
 {id:'control.panel',label:'Control panel',primitives:[rect(5,3,14,18,2),circle(9,8,1,true),circle(15,8,1,true),line(8,14,16,14)]},
 {id:'instrumentation.sensor',label:'Sensor',primitives:[circle(12,10,6),line(12,16,12,22),path('M8 10h8')]},
 {id:'process.reactor',label:'Reactor',primitives:[path('M7 5c0-2 10-2 10 0v14c0 2-10 2-10 0Z'),path('M9 7v10m3-10v10m3-10v10')]},
].forEach(registerGlyph);
