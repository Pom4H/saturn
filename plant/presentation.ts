import { AppError, type Expr, type Sample } from './types';
import { evaluate } from './expressions';
import { chartSVG, escape } from './graphics';

export interface MotionSpec {
    binding: string;
    property: 'opacity'|'scale'|'rotate'|'pulse';
    min: number;
    max: number;
    from: number;
    to: number;
}
/** One serializable presentation tree. Bindings belong to each usage, not the widget. */
export type ViewNode =
    | { kind: 'group'; title?: string; direction: 'row'|'column'; children: ViewNode[] }
    | { kind: 'text'; text: string }
    | { kind: 'value'; label: string; binding: string; unit: string; digits: number }
    | { kind: 'table'; columns: {key:string;title:string;unit?:string}[] }
    | { kind: 'chart'; title: string; x: string; y: string }
    | { kind: 'action'; label: string; target: string; value: number }
    | { kind: 'navigate'; label: string; target: string }
    | { kind: 'motion'; motion: MotionSpec; child: ViewNode };
export interface PresentationScreen { id:string; title:string; body:ViewNode }
export interface Presentation {
    id: string;
    title: string;
    body: ViewNode;
    bindings: Record<string, Expr>;
    screens?: PresentationScreen[];
    initial?: string;
}
export interface PresentationContext {
    values: Record<string, Sample>;
    rows?: Record<string,unknown>[];
    interactive?: boolean;
    screen?: string;
}
const key = (s:unknown):s is string => typeof s==='string'&&/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(s);
const text = (s:unknown, limit=200):s is string => typeof s==='string'&&s.length<=limit;
export function presentationScreens(view:Presentation):PresentationScreen[] {
    return view.screens?.length ? view.screens : [{id:'main',title:view.title,body:view.body}];
}
export function presentationBody(view:Presentation,screen?:string):ViewNode {
    const screens=presentationScreens(view), id=screen??view.initial??screens[0].id;
    return screens.find(s=>s.id===id)?.body??screens[0].body;
}
export function validatePresentation(view:Presentation, target:'web'|'report'|'plc'='web'):void {
    if(!view||!key(view.id)||!text(view.title)||!view.bindings||Array.isArray(view.bindings)||Object.keys(view.bindings).length>64)throw new AppError('Invalid presentation');
    for(const k of Object.keys(view.bindings))if(!key(k))throw new AppError('Invalid presentation binding');
    const screens=presentationScreens(view);
    if(screens.length>16)throw new AppError('Presentation screen budget');
    const ids=new Set<string>();
    for(const screen of screens){
        if(!key(screen.id)||!text(screen.title)||ids.has(screen.id))throw new AppError('Invalid presentation screen');
        ids.add(screen.id);
    }
    if(view.initial!==undefined&&!ids.has(view.initial))throw new AppError('Unknown initial presentation screen');
    let count=0;
    const visit=(node:ViewNode,depth:number):void=>{
        if(!node||typeof node!=='object'||++count>256||depth>10)throw new AppError('Presentation exceeds structure budget');
        switch(node.kind){
            case 'group':
                if(!['row','column'].includes(node.direction)||!Array.isArray(node.children)||node.children.length>64||(node.title!==undefined&&!text(node.title)))throw new AppError('Invalid presentation group');
                node.children.forEach(n=>visit(n,depth+1));break;
            case 'text':if(!text(node.text,2000))throw new AppError('Invalid presentation text');break;
            case 'value':
                if(!text(node.label)||!key(node.binding)||!Object.hasOwn(view.bindings,node.binding)||!text(node.unit,30)||!Number.isInteger(node.digits)||node.digits<0||node.digits>6)throw new AppError('Invalid presentation readout');break;
            case 'table':
                if(!Array.isArray(node.columns)||!node.columns.length||node.columns.length>32||node.columns.some(c=>!c||!key(c.key)||!text(c.title)||(c.unit!==undefined&&!text(c.unit,30))))throw new AppError('Invalid presentation table');break;
            case 'chart':if(!text(node.title)||!key(node.x)||!key(node.y))throw new AppError('Invalid presentation chart');break;
            case 'action':if(!text(node.label)||!key(node.target)||!Number.isFinite(node.value))throw new AppError('Invalid presentation action');break;
            case 'navigate':
                if(!text(node.label)||!ids.has(node.target))throw new AppError('Invalid presentation navigation');
                break;
            case 'motion':
                if(!key(node.motion.binding)||!Object.hasOwn(view.bindings,node.motion.binding)||!['opacity','scale','rotate','pulse'].includes(node.motion.property)||![node.motion.min,node.motion.max,node.motion.from,node.motion.to].every(Number.isFinite)||node.motion.max<=node.motion.min)throw new AppError('Invalid presentation motion');
                visit(node.child,depth+1);break;
            default:throw new AppError('Unknown presentation node');
        }
        if(target==='plc'&&!['group','text','value'].includes(node.kind))throw new AppError(`PLC display does not support ${node.kind}`);
    };
    for(const screen of screens)visit(screen.body,0);
}
/** Only supplied observations are visible. A report supplies a pinned capsule, never live state. */
export function bindPresentation(view:Presentation,samples:Record<string,Sample>,time:number):Record<string,Sample>{
    return Object.fromEntries(Object.entries(view.bindings).map(([name,expr])=>[name,evaluate(expr,id=>samples[id]??{value:null,quality:'bad',time},time)]));
}
export function presentationActions(node:ViewNode):Extract<ViewNode,{kind:'action'}>[] {
    if(node.kind==='group')return node.children.flatMap(presentationActions);
    if(node.kind==='motion')return presentationActions(node.child);
    return node.kind==='action'?[node]:[];
}
export function renderPresentation(view:Presentation,context:PresentationContext):string {
    validatePresentation(view);const rows=context.rows??[],counts:Record<string,number>={};
    if(rows.length>2000)throw new AppError('Presentation row budget');
    const meta=(node:ViewNode)=>{const index=counts[node.kind]??0;counts[node.kind]=index+1;return ` data-studio-kind="${node.kind}" data-studio-index="${index}" tabindex="0"`;};
    const render=(node:ViewNode):string=>{
        const studio=meta(node);
        switch(node.kind){
            case 'group':return `<section class="pv-group pv-${node.direction}"${studio}>${node.title?`<h3>${escape(node.title)}</h3>`:''}<div class="pv-children">${node.children.map(render).join('')}</div></section>`;
            case 'text':return `<p class="pv-text"${studio}>${escape(node.text)}</p>`;
            case 'value':{const s=context.values[node.binding],valid=s?.quality==='good'&&s.value!==null&&Number.isFinite(s.value);return `<div class="pv-value" data-quality="${valid?'good':'bad'}" data-studio-binding="${escape(node.binding)}"${studio}><span>${escape(node.label)}</span><strong data-view-value="${escape(node.binding)}" data-digits="${node.digits}" data-unit="${escape(node.unit)}">${valid?s.value!.toFixed(node.digits):'—'}</strong><small>${escape(node.unit)}${valid?'':' · нет достоверных данных'}</small></div>`; }
            case 'table':return `<div class="pv-scroll"${studio}><table><thead><tr>${node.columns.map(c=>`<th>${escape(c.title)}${c.unit?` (${escape(c.unit)})`:''}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${node.columns.map(c=>`<td>${escape(typeof row[c.key]==='number'?Number(row[c.key]).toFixed(3):row[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
            case 'chart':return `<figure${studio}><figcaption>${escape(node.title)}</figcaption>${chartSVG(rows,node.x,node.y)}</figure>`;
            case 'action':return `<button type="button" data-view-command="${escape(node.target)}" data-view-set="${node.value}" data-studio-target="${escape(node.target)}"${studio}${context.interactive?'':' disabled aria-label="Команда недоступна в снимке отчёта"'}>${escape(node.label)}</button>`;
            case 'navigate':return `<button type="button" class="pv-nav" data-view-screen="${escape(node.target)}"${studio}${context.interactive?'':' disabled'}>${escape(node.label)}</button>`;
            case 'motion':return `<div class="pv-motion" data-view-motion="${escape(node.motion.binding)}" data-motion-property="${node.motion.property}" data-motion-min="${node.motion.min}" data-motion-max="${node.motion.max}" data-motion-from="${node.motion.from}" data-motion-to="${node.motion.to}"${studio}>${render(node.child)}</div>`;
        }
    };
    const screens=presentationScreens(view), active=context.screen??view.initial??screens[0].id, body=presentationBody(view,active);
    return `<article class="presentation" data-view="${escape(view.id)}" data-view-screen-active="${escape(active)}">${render(body)}</article>`;
}
export const presentationCss=`.presentation{font:inherit;color:inherit}.pv-group{border:1px solid #cad6db;padding:16px;margin:8px 0;border-radius:4px}.pv-group h3{margin:0 0 12px;font-size:16px}.pv-children{display:flex;gap:16px;flex-wrap:wrap}.pv-column>.pv-children{flex-direction:column}.pv-children>*{min-width:0;max-width:100%}.pv-value{display:grid;gap:6px;min-width:130px}.pv-value strong{font-size:26px;font-variant-numeric:tabular-nums;color:#087f8c}.pv-value[data-quality=bad] strong{color:#66737d}.pv-value small{color:#66737d}.pv-text{white-space:pre-wrap}.pv-scroll{overflow:auto;max-width:100%}.presentation table{width:100%;border-collapse:collapse}.presentation th,.presentation td{padding:8px;text-align:left;border-bottom:1px solid #cad6db}.presentation figure{margin:0}.presentation svg{width:100%;max-height:300px}.presentation button{min-height:40px;padding:8px 16px}.pv-nav{background:#f4f8fa}.pv-motion{transform-origin:center;will-change:transform,opacity}@keyframes pv-pulse{50%{opacity:.35}}@media print{.pv-group{break-inside:avoid}.pv-scroll{overflow:visible}.pv-nav{display:none}.pv-motion{transform:none!important;opacity:1!important;animation:none!important}}`;
