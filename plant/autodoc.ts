import type { Project, Expr } from './types';
import { model } from './models';
import { refs } from './project-validation';
import { SignalCatalog, type Signal, type SignalOrigin } from './signals';

export interface ProjectDocumentationOptions {
  locale?: 'ru'|'en';
  signals?: SignalCatalog | readonly Signal[];
}

const esc=(s:unknown)=>String(s??'').replaceAll('|','\\|').replaceAll('\n',' ');
const expr=(value:Expr):string => typeof value==='number'||typeof value==='boolean' ? String(value) : 'ref' in value ? value.ref : value.op + '(' + value.args.map(expr).join(', ') + ')';
const origin=(o:SignalOrigin):string => o.kind==='protocol'
  ? o.protocol + ' · ' + o.endpoint + (o.address ? ' · ' + o.address : '')
  : o.kind==='derived'||o.kind==='aggregate'
    ? o.kind + ' ← ' + o.dependencies.join(', ')
    : o.kind;
const heading=(ru:boolean,ruText:string,enText:string)=>ru?ruText:enText;

export function projectSignalCatalog(project:Project):SignalCatalog {
  const catalog=new SignalCatalog();
  for(const simulation of project.simulations){
    const spec=model(simulation.model);
    for(const [key,unit] of Object.entries(spec.outputs)){
      const type=spec.outputTypes?.[key]??'number', dimension=spec.outputDimensions?.[key]??'unknown';
      catalog.add({definition:{id:simulation.id+'.'+key,kind:type,access:'read',unit,dimension,origin:{kind:'simulation',model:simulation.model}}} as Signal);
    }
  }
  for(const s of project.signals) catalog.add({definition:{id:s.id,kind:'number',access:'read',unit:s.unit,origin:{kind:'derived',dependencies:refs(s.expression),expression:s.expression}}} as Signal);
  for(const c of project.controls??[]){
    catalog.add(
      {definition:{id:c.id+'.value',kind:'number',access:'read',unit:c.unit,origin:{kind:'manual'}}} as Signal,
      {definition:{id:c.id+'.requested',kind:'number',access:'read-write',unit:c.unit,origin:{kind:'manual'}}} as Signal,
      {definition:{id:c.id+'.blocked',kind:'boolean',access:'read',unit:'',origin:{kind:'derived',dependencies:c.enableWhen?refs(c.enableWhen):[]}}} as Signal,
    );
  }
  return catalog;
}

export function generateProjectDocumentation(project:Project, options:ProjectDocumentationOptions={}):string {
  const ru=options.locale!=='en';
  const supplied=options.signals instanceof SignalCatalog ? options.signals.list() : options.signals;
  const signals=supplied??projectSignalCatalog(project).list();
  const lines:string[]=[
    '# '+project.title,'',project.description,'',
    '> '+heading(ru,'Сгенерировано из исполняемой модели Saturn. Не редактируйте вручную.','Generated from the executable Saturn model. Do not edit manually.'),'',
    '## '+heading(ru,'Структура объекта','Plant structure'),'',
  ];
  for(const system of project.systems) lines.push('- **'+esc(system.title)+'** ('+system.id+')'+(system.parent?' ← '+system.parent:''));
  lines.push('','## '+heading(ru,'Сигналы','Signals'),'','| Signal | Type | Access | Unit | Source |','|---|---|---|---|---|');
  for(const s of signals) lines.push('| '+esc(s.definition.id)+' | '+s.definition.kind+' | '+s.definition.access+' | '+esc(s.definition.unit??'')+' | '+esc(origin(s.definition.origin))+' |');

  lines.push('','## '+heading(ru,'Оборудование и поведение','Equipment and behavior'),'');
  for(const n of project.simulations){
    const spec=model(n.model);
    lines.push('### '+n.id,'','- '+heading(ru,'Модель','Model')+': '+n.model,'- '+heading(ru,'Система','System')+': '+n.system);
    const inputs=Object.entries(n.inputs);
    if(inputs.length){
      lines.push('- '+heading(ru,'Входы','Inputs')+':');
      for(const [k,v] of inputs) lines.push('  - '+k+' ← '+expr(v));
    }
    const outputs=Object.keys(spec.outputs);
    if(outputs.length) lines.push('- '+heading(ru,'Выходы','Outputs')+': '+outputs.map(k=>n.id+'.'+k).join(', '));
    lines.push('');
  }

  if(project.signals.length){
    lines.push('## '+heading(ru,'Вычисляемые зависимости','Derived dependencies'),'');
    for(const s of project.signals) lines.push('- '+s.id+' = '+expr(s.expression));
    lines.push('');
  }

  if(project.alarms.length){
    lines.push('## '+heading(ru,'Аварии и предупреждения','Alarms and warnings'),'','| Rule | Signal | Raise | Clear | Delay | Priority |','|---|---|---:|---:|---:|---|');
    for(const a of project.alarms) lines.push('| '+esc(a.title)+' | '+expr(a.signal)+' | '+a.above+' | '+a.clearBelow+' | '+a.delay+' ms | '+a.priority+' |');
    lines.push('');
  }

  if((project.connections??[]).length){
    lines.push('## '+heading(ru,'Физические связи','Physical connections'),'');
    for(const c of project.connections??[]) lines.push('- '+c.id+': '+c.from.device+'.'+c.from.port+' → '+c.to.device+'.'+c.to.port+' ('+c.medium+')');
    lines.push('');
  }

  if((project.controls??[]).length){
    lines.push('## '+heading(ru,'Управление','Controls'),'');
    for(const c of project.controls??[]) lines.push('- **'+esc(c.title)+'** ('+c.id+'): '+c.min+'…'+c.max+' '+esc(c.unit)+(c.enableWhen?' · '+heading(ru,'разрешено когда','enabled when')+' '+expr(c.enableWhen):''));
    lines.push('');
  }

  if(project.reports.length){
    lines.push('## '+heading(ru,'Отчёты','Reports'),'');
    for(const r of project.reports) lines.push('- **'+esc(r.title)+'** ('+r.id+') ← '+r.signals.join(', '));
    lines.push('');
  }

  lines.push('## '+heading(ru,'Поток данных','Data flow'),'','source → decode → typed signal → quality → runtime → HMI / alarms / historian / reports','');
  return lines.join('\n');
}
