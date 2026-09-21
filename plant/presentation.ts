import type { Expr, Sample } from './types';
import { failCode } from './diagnostics';
import { evaluate } from './expressions';
import { chartSVG, escape } from './graphics';

/** One serializable presentation tree. Bindings belong to each usage, not the widget. */
export type ViewNode =
    | { kind: 'group'; title?: string; direction: 'row'|'column'; children: ViewNode[] }
    | { kind: 'text'; text: string }
    | { kind: 'value'; label: string; binding: string; unit: string; digits: number }
    | { kind: 'table'; columns: {key:string;title:string;unit?:string}[] }
    | { kind: 'chart'; title: string; x: string; y: string }
    | { kind: 'action'; label: string; target: string; value: number };
export interface Presentation { id: string; title: string; body: ViewNode; bindings: Record<string, Expr> }
export interface PresentationContext { values: Record<string, Sample>; rows?: Record<string,unknown>[]; interactive?: boolean }
const key = (s:unknown):s is string => typeof s==='string'&&/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(s);
const text = (s:unknown, limit=200):s is string => typeof s==='string'&&s.length<=limit;
export function validatePresentation(view:Presentation, target:'web'|'report'|'plc'='web'):void {
    if(!view||!key(view.id)||!text(view.title)||!view.bindings||Array.isArray(view.bindings)||Object.keys(view.bindings).length>64)failCode('SATURN_PRESENTATION_INVALID',{reason:'malformed'},{field:'root'});
    for(const k of Object.keys(view.bindings))if(!key(k))failCode('SATURN_PRESENTATION_INVALID',{reason:'invalid'},{field:'binding'});
    let count=0;
    const visit=(node:ViewNode,depth:number):void=>{
        if(!node||typeof node!=='object'||++count>128||depth>8)failCode('SATURN_LIMIT',{resource:'presentation',reason:'tooMany'},{maxNodes:128,maxDepth:8});
        switch(node.kind){
            case 'group':
                if(!['row','column'].includes(node.direction)||!Array.isArray(node.children)||node.children.length>64||(node.title!==undefined&&!text(node.title)))failCode('SATURN_PRESENTATION_INVALID',{reason:'invalid'},{field:'group'});
                node.children.forEach(n=>visit(n,depth+1));break;
            case 'text':if(!text(node.text,2000))failCode('SATURN_PRESENTATION_INVALID',{reason:'invalid'},{field:'text'});break;
            case 'value':
                if(!text(node.label)||!key(node.binding)||!Object.hasOwn(view.bindings,node.binding)||!text(node.unit,30)||!Number.isInteger(node.digits)||node.digits<0||node.digits>6)failCode('SATURN_PRESENTATION_INVALID',{reason:'invalid'},{field:'value'});break;
            case 'table':
                if(!Array.isArray(node.columns)||!node.columns.length||node.columns.length>32||node.columns.some(c=>!c||!key(c.key)||!text(c.title)||(c.unit!==undefined&&!text(c.unit,30))))failCode('SATURN_PRESENTATION_INVALID',{reason:'invalid'},{field:'table'});break;
            case 'chart':if(!text(node.title)||!key(node.x)||!key(node.y))failCode('SATURN_PRESENTATION_INVALID',{reason:'invalid'},{field:'chart'});break;
            case 'action':if(!text(node.label)||!key(node.target)||!Number.isFinite(node.value))failCode('SATURN_PRESENTATION_INVALID',{reason:'invalid'},{field:'action'});break;
            default:failCode('SATURN_PRESENTATION_INVALID',{reason:'unknown'},{field:'node'});
        }
        if(target==='plc'&&!['group','text','value'].includes(node.kind))failCode('SATURN_PRESENTATION_INVALID',{reason:'invalid'},{target:'plc',nodeKind:node.kind});
    };
    visit(view.body,0);
}
/** Only supplied observations are visible. A report supplies a pinned capsule, never live state. */
export function bindPresentation(view:Presentation,samples:Record<string,Sample>,time:number):Record<string,Sample>{
    return Object.fromEntries(Object.entries(view.bindings).map(([name,expr])=>[name,evaluate(expr,id=>samples[id]??{value:null,quality:'bad',time},time)]));
}
export function presentationActions(node:ViewNode):Extract<ViewNode,{kind:'action'}>[] {
    return node.kind==='group'?node.children.flatMap(presentationActions):node.kind==='action'?[node]:[];
}
export function renderPresentation(view:Presentation,context:PresentationContext):string {
    validatePresentation(view);const rows=context.rows??[];
    if(rows.length>2000)failCode('SATURN_LIMIT',{resource:'presentation.rows',reason:'rowBudget'},{maxRows:2000});
    const render=(node:ViewNode):string=>{
        switch(node.kind){
            case 'group':return `<section class="pv-group pv-${node.direction}">${node.title?`<h3>${escape(node.title)}</h3>`:''}<div class="pv-children">${node.children.map(render).join('')}</div></section>`;
            case 'text':return `<p class="pv-text">${escape(node.text)}</p>`;
            case 'value':{const s=context.values[node.binding],valid=s?.quality==='good'&&s.value!==null&&Number.isFinite(s.value);return `<div class="pv-value" data-quality="${valid?'good':'bad'}"><span>${escape(node.label)}</span><strong data-view-value="${escape(node.binding)}" data-digits="${node.digits}" data-unit="${escape(node.unit)}">${valid?s.value!.toFixed(node.digits):'—'}</strong><small>${escape(node.unit)}${valid?'':' · нет достоверных данных'}</small></div>`;}
            case 'table':return `<div class="pv-scroll"><table><thead><tr>${node.columns.map(c=>`<th>${escape(c.title)}${c.unit?` (${escape(c.unit)})`:''}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${node.columns.map(c=>`<td>${escape(typeof row[c.key]==='number'?Number(row[c.key]).toFixed(3):row[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
            case 'chart':return `<figure><figcaption>${escape(node.title)}</figcaption>${chartSVG(rows,node.x,node.y)}</figure>`;
            case 'action':return `<button type="button" data-view-command="${escape(node.target)}" data-view-set="${node.value}"${context.interactive?'':' disabled aria-label="Команда недоступна в снимке отчёта"'}>${escape(node.label)}</button>`;
        }
    };return `<article class="presentation" data-view="${escape(view.id)}">${render(view.body)}</article>`;
}
export const presentationCss=`.presentation{font:inherit;color:inherit}.pv-group{border:1px solid #cad6db;padding:16px;margin:8px 0;border-radius:4px}.pv-group h3{margin:0 0 12px;font-size:16px}.pv-children{display:flex;gap:16px;flex-wrap:wrap}.pv-column>.pv-children{flex-direction:column}.pv-children>*{min-width:0;max-width:100%}.pv-value{display:grid;gap:6px;min-width:130px}.pv-value strong{font-size:26px;font-variant-numeric:tabular-nums;color:#087f8c}.pv-value[data-quality=bad] strong{color:#66737d}.pv-value small{color:#66737d}.pv-text{white-space:pre-wrap}.pv-scroll{overflow:auto;max-width:100%}.presentation table{width:100%;border-collapse:collapse}.presentation th,.presentation td{padding:8px;text-align:left;border-bottom:1px solid #cad6db}.presentation figure{margin:0}.presentation svg{width:100%;max-height:300px}.presentation button{min-height:40px;padding:8px 16px}@media print{.pv-group{break-inside:avoid}.pv-scroll{overflow:visible}}`;
