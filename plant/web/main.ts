import { bindPresentation, renderPresentation, presentationCss, presentationActions, presentationScreens } from '../presentation';
import { widgetSource, patchWidget, lineLabel, textSource, type StudioSource } from '../studio';
import { deriveHmi } from '../auto-hmi';
import { terminals, resolvePort, type Endpoint, type Connection as PhysicalConnection } from '../ports';
import { appendConnection, addExpansionSource, removeConnection } from '../connection-edit';
import { renderSaturnPlcSvg } from '../saturn-view';
import { drawHmiSvg } from '../hmi-view';
import type { SceneView3D } from '../../src/view3d';
import { EditorState } from '@codemirror/state';
import { EditorView, basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { SceneView, el } from '../../src/view';
import { installEquipment, sceneFor, visualFrame, references } from '../equipment';
import { models, model } from '../models';
import { compileProject, validateFiles } from '../compiler';
import { chartSVG, escape } from '../workflows';
import { LocalClient, RemoteClient, type Connection, type Status, type Revision, type Frame, type ReportArtifact, type ReportData } from './client';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const base = new URL('../', location.href), demo = location.pathname.endsWith('/demo/');
let client: Connection, status: Status, frame: Frame, scene: SceneView, system = '', selected: string | null = null, tab = 'scheme', file = 'plant.ts', files: Record<string, string> = {}, head: string | null = null, dirty = false, validDraft = true, editor: EditorView, loadingEditor = false, failed = false;
let scene3d: SceneView3D | undefined, viewMode: '2d' | '3d' = '2d', changingView = false;
let studioEditors: Partial<Record<'view'|'report',EditorView>>={}, studioFiles:Partial<Record<'view'|'report',string>>={}, studioLoading=false;
let studioSelection:Partial<Record<'view'|'report',{kind:any,index:number,source:StudioSource|null}>>={};
let liveHmiScreen='';
const autoHmiCache=new WeakMap<object,ReturnType<typeof deriveHmi>>();
let registration: ServiceWorkerRegistration | undefined, pendingInstall: any, noticeEnabled = false, closed = false;
const fmt = (v: number | null | undefined, digits = 2) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—';
const time = (v: number | null | undefined) => v ? new Date(v).toLocaleString('ru-RU') : '—';
function toast(message: string) { $('toast').textContent = message; $('toast').hidden = false; setTimeout(() => $('toast').hidden = true, 4000); }
function error(message: string) { $('error').textContent = message; $('error').hidden = false; }
async function guard<T>(fn: () => Promise<T> | T): Promise<T | undefined> { try {
    return await fn();
}
catch (e) {
    error(e instanceof Error ? e.message : String(e));
    return undefined;
} }
function ensureActive() { if (failed)
    throw new Error('Нет достоверной связи с runtime'); }
function refreshActions() { for (const id of ['pause', 'restart', 'commit', 'publish'])
    $(id).toggleAttribute('disabled', failed || (id === 'publish' && (dirty || !validDraft))); }
async function command(action: string, extra: object = {}) { ensureActive(); const result = await client.request('command', { id: `cmd-${crypto.randomUUID()}`, revision: frame.revision, runId: frame.runId, action, ...extra }); await refreshStatus(); if (action === 'set')
    renderInspector(); return result; }
async function refreshStatus() { const previous = status?.project; status = await client.request<Status>('session'); frame = status.frame; if (previous !== status.project && JSON.stringify(previous) !== JSON.stringify(status.project))
    setupProject(); renderFrame(frame); refreshActions(); }
function setupProject() {
    $('title').textContent = status.project.title;
    $('description').textContent = status.project.description;
    if (!status.project.systems.some(s => s.id === system)) system = '';
    if (!status.project.devices.some(d => d.id === selected)) selected = null;
    $('tree').replaceChildren();
    const all = document.createElement('button'); all.textContent = 'Все системы'; all.dataset.system = ''; all.onclick = () => focusSystem(''); $('tree').append(all);
    const append = (parent?: string, depth = 0) => { for (const group of status.project.systems.filter(g => g.parent === parent)) {
        const button = document.createElement('button');
        button.textContent = group.title;
        button.dataset.system = group.id;
        button.style.paddingLeft = `${8 + depth * 12}px`;
        button.onclick = () => focusSystem(group.id);
        $('tree').append(button);
        append(group.id, depth + 1);
    } };
    append();
    const definitions = status.project.reports.map(r => `<div class="card"><div class="card-header"><div><h3>${escape(r.title)}</h3><span class="badge">${escape(r.id)}</span></div><button data-run="${escape(r.id)}" ${!r.on.workflow_dispatch || status.actor.role === 'viewer' ? 'disabled' : ''}>Запустить</button></div><p>${r.on.schedule?.length ? escape(r.on.schedule.map(s => s.cron + ' UTC').join(', ')) : 'Только вручную'} · окно ${Math.round(r.window / 60000)} мин</p><div class="report-inputs">${Object.entries(r.on.workflow_dispatch?.inputs ?? {}).map(([k, v]) => `<label>${escape(k)}<input type="number" data-report="${escape(r.id)}" data-input="${escape(k)}" min="${v.min}" max="${v.max}" value="${v.default}" step="any"></label>`).join('')}</div></div>`).join('');
    $('report-definitions').innerHTML = definitions;
    renderScene();
    renderMetrics();
    renderControls();
    renderInventory();
    setupViews();
}
function renderScene() {
    if (!scene)
        return;
    const next = sceneFor(status.project);
    scene.render(next);
    scene.setRuntime(visualFrame(status.project, frame));
    scene.select(selected);
    if (scene3d) { scene3d.render(next); scene3d.setRuntime(visualFrame(status.project, frame)); scene3d.select(selected); }
    focusSystem(system);
    drawDependencies();
    renderInspector();
}
function focusSystem(id: string) {
    system = id;
    const group = scene.scene.groups?.find(g => g.id === id);
    $('system-title').textContent = group ? group.title : 'Все системы · единый холст';
    $('system-count').textContent = `${scene.scene.nodes.length} приборов на холсте${group ? ` · ${group.count} в выбранной группе` : ` · ${scene.scene.groups?.length ?? 0} групп`}`;
    document.querySelectorAll<HTMLElement>('[data-system]').forEach(button => {
        button.classList.toggle('selected', button.dataset.system === id);
        button.setAttribute('aria-pressed', String(button.dataset.system === id));
    });
    scene.svg.dataset.focusedGroup = id;
    if (group) { scene.fitGroup(id); scene3d?.focusGroup(id); if (viewMode === '3d') scene3d?.fitGroup(id); }
    else { scene.fit(); scene3d?.focusGroup(null); if (viewMode === '3d') scene3d?.fit(); }
}

function dependencies(target: string): string[] { const node = status.project.simulations.find(n => n.id === target); if (!node)
    return []; const outputs = new Map<string, string>(status.project.simulations.flatMap(n => Object.keys(model(n.model).outputs).map(k => [`${n.id}.${k}`, n.id] as const))); const derived = new Map(status.project.signals.map(s => [s.id, s.expression])); const collect = (ref: string): string[] => outputs.has(ref) ? [outputs.get(ref)!] : derived.has(ref) ? references(derived.get(ref)!).flatMap(collect) : []; return [...new Set(Object.values(node.inputs).flatMap(references).flatMap(collect))].filter(id => id !== target); }
function drawDependencies() {
    const svg = $<HTMLElement>('diagram') as unknown as SVGSVGElement;
    svg.querySelector('.signal-links')?.remove();
    $('boundary').textContent = '';
    scene3d?.showSignalDependencies(selected, selected ? dependencies(selected) : []);
    if (!selected)
        return;
    const nodes = new Map(scene.scene.nodes.map(n => [n.id, n])), target = nodes.get(selected);
    if (!target)
        return;
    const layer = el(svg, 'g', { class: 'signal-links', 'pointer-events': 'none' });
    svg.insertBefore(layer, svg.querySelector('[data-scene]'));
    const external: string[] = [];
    for (const source of dependencies(selected)) {
        const from = nodes.get(source);
        if (!from) {
            external.push(source);
            continue;
        }
        const x = Number(from.props.x) + 150, y = Number(from.props.y) + 48, tx = Number(target.props.x), ty = Number(target.props.y) + 48;
        el(layer, 'path', { 'data-from': source, 'data-to': selected, d: `M${x} ${y} C${(x + tx) / 2} ${y} ${(x + tx) / 2} ${ty} ${tx} ${ty}` });
        el(layer, 'circle', { cx: tx, cy: ty, r: 4, fill: '#567f90' });
    }
    if (external.length)
        $('boundary').textContent = `Входы из других подсистем: ${external.join(', ')}`;
}
function renderMetrics() { const metrics = status.project.overview ?? status.project.signals.slice(0, 5).map(s => ({ signal: s.id, label: s.id, unit: s.unit, alarmAbove: undefined })); $('metrics').innerHTML = metrics.map(m => `<div class="metric" data-metric="${escape(m.signal)}" ${m.alarmAbove === undefined ? '' : `data-above="${m.alarmAbove}"`}><div class="metric-label">${escape(m.label)}</div><div class="metric-value"><span>—</span><small>${escape(m.unit)}</small></div><div class="metric-foot">${escape(m.signal)}</div></div>`).join(''); }
function renderFrame(next: Frame) {
    if (!status)
        return;
    if (next.revision !== status.frame.revision) {
        status.frame = next;
        void guard(refreshStatus);
    }
    frame = next;
    status.frame = next;
    failed = !status.healthy;
    $('clock').textContent = `${new Date(frame.time).toISOString().slice(11, 19)} · шаг ${frame.seq}`;
    $('pause').textContent = frame.paused ? 'Продолжить' : 'Пауза';
    for (const node of document.querySelectorAll<HTMLElement>('[data-metric]')) {
        const id = node.dataset.metric!, sample = frame.samples[id];
        node.querySelector('.metric-value span')!.textContent = fmt(sample?.quality === 'good' ? sample.value : null);
        node.dataset.alert = String(node.dataset.above !== undefined && sample?.quality === 'good' && (sample?.value ?? 0) > Number(node.dataset.above));
    }
    const outstanding = frame.alarms.filter(a => a.active || (!a.acknowledged && a.raisedAt !== null));
    $('alarm-count').textContent = String(outstanding.length);
    const observation = visualFrame(status.project, frame);
    scene?.setRuntime(observation);
    if (scene3d) { scene3d.paused = frame.paused; scene3d.setRuntime(observation); }
    refreshControls();
    if(tab==='views')refreshView();
    const plcScreen=document.querySelector<SVGSVGElement>('#plc-front .runtime-hmi');if(plcScreen&&selected)drawHmiSvg(plcScreen,selected);
    if (scene)
        scene.paused = frame.paused;
    if (selected)
        for (const row of document.querySelectorAll<HTMLElement>('[data-signal]')) {
            const id = row.dataset.signal!, s = frame.samples[id];
            row.querySelector('b')!.textContent = s?.quality === 'good' ? fmt(s.value) : '—';
        }
    if (tab === 'alarms')
        renderAlarms();
    refreshActions();
}

let pendingTerminal:Endpoint|null=null;
function download(name:string,data:BlobPart,type:string){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function appendTerminalPanel(){
 $('inspector').querySelector('.terminal-panel')?.remove();
 if(!selected)return;const project=dirty&&validDraft?compileProject(files):status.project;const device=project.devices.find(d=>d.id===selected);if(!device)return;
 const section=document.createElement('section');section.className='terminal-panel';
 section.innerHTML=`<h3>Соединения · клеммы</h3><p>Выберите источник, затем вход на схеме или здесь. Соединение создаёт черновик DSL; публикация отдельная.</p><p id="connection-start"></p><div class="terminal-grid">${Object.entries(terminals(device.type)).map(([name,t])=>`<button data-connect-device="${escape(device.id)}" data-connect-port="${escape(name)}" title="${escape(t.family)} · ${t.role}"><b>${escape(name)}</b><small>${escape(t.medium)} · ${escape(t.family)}</small></button>`).join('')}</div><div class="connection-list">${(project.connections??[]).filter(w=>w.from.device===selected||w.to.device===selected).map(w=>`<p><b>${escape(w.medium)}</b> ${escape(w.from.device+'.'+w.from.port)} → ${escape(w.to.device+'.'+w.to.port)} <button data-disconnect="${escape(w.id)}">Отключить</button></p>`).join('')}</div>`;
 $('inspector').append(section);const state=$('connection-start');state.textContent=pendingTerminal?`Источник: ${pendingTerminal.device}.${pendingTerminal.port}`:'';
}
function renderPlcInspector(){
 const c=status.project.controllers?.find(c=>c.id===selected);if(!c){$('inspector').textContent=selected;return;}
 const modules=(status.project.attachments??[]).filter(m=>m.controller===c.id);
 $('inspector').innerHTML=`<p class="eyebrow">SATURN · FBD / WASM</p><h2>${escape(c.id)}</h2><div id="plc-front">${renderSaturnPlcSvg({defsPrefix:'inspector-'+c.id})}</div><div class="signals">${[...Object.keys(c.outputs),'healthy','powered'].map(k=>`<div class="signal-row" data-signal="${escape(c.id+'.'+k)}"><span>${escape(k)}</span><b>—</b></div>`).join('')}</div><button id="build-plc" ${status.actor.role!=='engineer'?'disabled':''}>Собрать .fbdbin + HMI</button><p class="model-limit">Программа для установленного FBD-runtime. Не прошивка загрузчика/HAL. Виртуальные модули не подтверждают совместимость с аппаратурой.</p><h3>Клеммы входов</h3><div class="signals">${Object.keys(terminals('saturn')).filter(k=>/^DI|^AI/.test(k)).map(k=>`<div class="signal-row" data-signal="${escape(c.id+'.'+k)}"><span>${escape(k)}</span><b>—</b></div>`).join('')}</div><h3>Модули расширения</h3>${modules.map(m=>`<p>Слот ${m.slot} · ${escape(m.device)} · ${escape(m.profile)}</p>`).join('')||'<p>Нет подключённых модулей</p>'}<button id="build-manifest">Скачать манифест сборки</button><button id="attach-module" ${status.actor.role!=='engineer'?'disabled':''}>Добавить виртуальный AI4</button>`;
 $('build-plc').onclick=()=>void guard(async()=>{const artifact=await client.request<any>('firmware',{controllerId:c.id,revision:frame.revision});download(c.id+'.fbdbin',new Uint8Array(artifact.fbdbin),'application/octet-stream');toast('Собраны программа и HMI. Манифест скачивается отдельно. Аппаратная загрузка не выполнялась.');});
 $('build-manifest').onclick=()=>void guard(async()=>{const {fbdbin,...manifest}=await client.request<any>('firmware',{controllerId:c.id,revision:frame.revision});download(c.id+'-build.json',JSON.stringify(manifest,null,2),'application/json');});
 $('attach-module').onclick=()=>void guard(()=>attachModule(c.id));
 appendTerminalPanel();renderFrame(frame);
}
function chooseTerminal(e:Endpoint){
 if(status.actor.role!=='engineer')throw new Error('Подключения изменяет инженер');
 const project=dirty?compileProject(files):status.project,{terminal}=resolvePort(project,e);
 if(!pendingTerminal){if(terminal.role==='sink')throw new Error('Сначала выберите выход источника');pendingTerminal=e;toast(`Источник ${e.device}.${e.port}. Выберите совместимый вход.`);selectEquipment(e.device);return;}
 if(pendingTerminal.device===e.device&&pendingTerminal.port===e.port){pendingTerminal=null;toast('Соединение отменено');return;}
 const start=pendingTerminal,source=resolvePort(project,start).terminal;
 const wire:PhysicalConnection={id:'W-'+crypto.randomUUID().slice(0,8),from:start,to:e,medium:source.medium};
 files=appendConnection(files,wire);pendingTerminal=null;dirty=true;validDraft=true;file='wiring.ts';populateFiles();setEditor();refreshActions();
 sessionStorage.setItem(`scada-draft:${demo?'demo':'server'}`,JSON.stringify({files,head,file}));
 const preview=sceneFor(compileProject(files));scene.render(preview);scene3d?.render(preview);appendTerminalPanel();toast('Соединение проверено и добавлено в wiring.ts. Сохраните commit и опубликуйте.');
}
function attachModule(controllerId:string){
 const project=compileProject(files),controller=project.controllers?.find(c=>c.id===controllerId);if(!controller)throw new Error('Контроллер отсутствует в черновике');
 const slots=new Set((project.attachments??[]).filter(a=>a.controller===controllerId).map(a=>a.slot));let slot=1;while(slots.has(slot))slot++;if(slot>8)throw new Error('Свободных слотов нет');
 // Deliberately explicit module authoring. The base program never guesses physical expansion addresses.
 const fileName='expansion-'+slot+'.ts';if(files[fileName])throw new Error('Файл модуля уже существует');
 const moduleId=controllerId+'-AI4-'+slot;
 const source=`import { simulation } from '@scada/plant';
export const module = simulation(${JSON.stringify(moduleId)}, 'io-module', {system:${JSON.stringify(controller.system)},at:{x:${controller.layout.x+400+(slot-1)*190},y:${controller.layout.y+650}}});
`;
 // Insert into the explicit project arrays via the existing bounded AST helper.
 const result=addExpansionSource(files,controllerId,moduleId,fileName,source,slot);files=result;dirty=true;validDraft=true;file=fileName;populateFiles();setEditor();refreshActions();toast('Модуль и слот добавлены в черновик. Подключите питание и обе жилы RS-485, затем опубликуйте.');
}
document.addEventListener('click',e=>{const remove=(e.target as Element).closest<HTMLElement>('[data-disconnect]');if(remove){void guard(()=>{if(status.actor.role!=='engineer')throw new Error('Нужны права инженера');files=removeConnection(files,remove.dataset.disconnect!);dirty=true;validDraft=true;file='wiring.ts';populateFiles();setEditor();refreshActions();scene.render(sceneFor(compileProject(files)));scene3d?.render(sceneFor(compileProject(files)));appendTerminalPanel();toast('Отключение в черновике. Сохраните и опубликуйте.');});return;}const target=(e.target as Element).closest<HTMLElement>('[data-connect-port],#diagram [data-port]');if(!target)return;e.stopPropagation();void guard(()=>chooseTerminal({device:target.dataset.connectDevice??target.dataset.owner!,port:target.dataset.connectPort??target.dataset.port!}));});
$('diagram').addEventListener('keydown',e=>{const target=(e.target as Element).closest<HTMLElement>('[data-port]');if(target&&(e.key==='Enter'||e.key===' ')){e.preventDefault();void guard(()=>chooseTerminal({device:target.dataset.owner!,port:target.dataset.port!}));}});
function renderInspector() {
    $('inspector').hidden = !selected;
    document.querySelector('.workspace')!.classList.toggle('has-selection', !!selected);
    if (!selected) {
        $('inspector').innerHTML = '<h2>Оборудование</h2><p>Выберите компонент на схеме. Входы могут поступать из любой подсистемы.</p>';
        return;
    }
    const n = status.project.simulations.find(n => n.id === selected);
    if (!n) { renderPlcInspector(); return; }
    const spec = model(n.model);
    $('inspector').innerHTML = `<p class="eyebrow">${escape(n.model)} / ${escape(spec.version)}</p><h2>${escape(n.id)}</h2><p>${escape(spec.title)}</p><div class="signals">${Object.entries(spec.outputs).map(([key, unit]) => `<div class="signal-row" data-signal="${escape(n.id + '.' + key)}"><span title="${escape(unit)}">${escape(key)}</span><b>—</b></div>`).join('')}</div><svg id="small-trend" class="trend" viewBox="0 0 400 130"></svg><div class="parameters"><h3>Параметры модели</h3><p>Изменения — команды текущего прогона; исходник проекта не меняется.</p>${Object.entries(spec.parameters).map(([key, d]) => `<label class="parameter"><span>${escape(key)}</span><input type="number" data-param="${escape(key)}" value="${status.overrides[`${n.id}.${key}`] ?? n.parameters[key]}" min="${d.min}" max="${d.max}" step="any"><button data-set="${escape(key)}" ${status.actor.role !== 'engineer' ? 'disabled' : ''} title="Применить">↵</button></label>`).join('')}</div><p class="model-limit">Условная модель. Числа не являются настройками реального оборудования.</p>`;
    appendTerminalPanel();
    renderFrame(frame);
    void updateTrend();
}
async function updateTrend() { if (tab !== 'scheme' || !selected || failed)
    return; const target = selected, n = status.project.simulations.find(n => n.id === target); if (!n)
    return; const key = `${n.id}.${Object.keys(model(n.model).outputs)[0]}`, to = frame.time, from = Math.max(0, to - 120000); try {
    const data = await client.request<ReportData>('history', { signals: [key], from, to });
    if (target !== selected)
        return;
    const svg = $('small-trend');
    if (svg) {
        const points = data.samples.map(s => ({ time: s.time, value: s.quality === 'good' ? s.value : null }));
        svg.outerHTML = chartSVG(points, 'time', 'value').replace('<svg ', '<svg id="small-trend" class="trend" ');
    }
}
catch { /* Keep live values; history errors are shown in explicit report/history requests. */ } }
function renderAlarms() { const list = frame.alarms.filter(a => a.raisedAt !== null).sort((a, b) => Number(b.active) - Number(a.active)); $('alarm-list').innerHTML = list.length ? list.map(a => { const rule = status.project.alarms.find(r => r.id === a.id); return `<div class="card ${a.active ? 'active' : ''}"><div class="card-header"><div><h3>${escape(rule?.title ?? a.id)}</h3><span class="badge ${a.active ? 'active' : ''}">${a.active ? 'Причина активна' : 'Причина исчезла'}</span> <span class="badge">${a.acknowledged ? 'Квитировано' : 'Не квитировано'}</span></div><button data-ack="${escape(a.id)}" ${a.acknowledged ? 'disabled' : ''}>Квитировать</button></div><p>Возникло: ${time(a.raisedAt)} · качество: ${escape(a.quality)}</p><p>Квитирование: ${escape(a.actor ?? '—')} · ${time(a.acknowledgedAt)} · Возврат: ${time(a.clearedAt)}</p></div>`; }).join('') : '<div class="empty">Активных и неквитированных алармов нет.</div>'; }
async function refreshPanel() {
    if(tab==='views')refreshView();
    if (tab === 'alarms')
        renderAlarms();
    if (tab === 'inventory') renderInventory();
    if (tab === 'reports') {
        const rows = await client.request<Record<string, any>[]>('reports');
        $('report-runs').innerHTML = rows.length ? `<div class="table-scroll"><table><thead><tr><th>Отчёт / запуск</th><th>Триггер</th><th>Ревизия</th><th>Статус</th><th></th></tr></thead><tbody>${rows.map(r => `<tr><td>${escape(r.reportId)}<br><small>${time(r.createdAt)}</small></td><td>${escape(r.trigger)}</td><td>${escape(String(r.revision).slice(0, 16))}</td><td><span class="badge ${escape(r.status)}">${escape(r.status)}</span>${r.error ? `<p>${escape(r.error)}</p>` : ''}</td><td><button data-artifact="${escape(r.id)}" ${r.status !== 'success' ? 'disabled' : ''}>Открыть</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Отчётов пока нет. Запустите первый вручную.</div>';
    }
    if (tab === 'events') {
        const rows = await client.request<Record<string, any>[]>('events');
        $('event-list').innerHTML = `<div class="table-scroll"><table><thead><tr><th>Время модели</th><th>Событие</th><th>Объект</th><th>Автор</th><th>Детали</th></tr></thead><tbody>${rows.map(e => `<tr><td>${time(e.time)}</td><td>${escape(e.type)}</td><td>${escape(e.subject)}</td><td>${escape(e.actor ?? '—')}</td><td>${escape(e.detail)}</td></tr>`).join('')}</tbody></table></div>`;
    }
    if (tab === 'project') {
        const revisions = await client.request<Omit<Revision, 'files'>[]>('revisions');
        $('revisions-summary').textContent = `Активная: ${frame.revision} · ${demo ? 'Локальная история снимков, не формат .git' : 'Репозиторий Git сервера'}`;
        $('revision-list').innerHTML = revisions.map(r => `<div class="card"><div class="card-header"><div><h3>${escape(r.message)}</h3><p>${escape(r.id)} · ${escape(r.actor)} · ${time(r.time)}</p></div><button data-rollback="${escape(r.id)}">Восстановить версию</button></div></div>`).join('');
    }
}
async function loadFiles() { if (dirty && !confirm('Загрузить сохранённое? Текущий черновик останется в файле восстановления браузера.'))
    return; const revision = await client.request<Revision>('project'); if (!revision)
    return; files = revision.files; head = revision.id; dirty = false; validDraft = true; if (!(file in files))
    file = Object.keys(files)[0]; $('file').innerHTML = Object.keys(files).map(path => `<option ${path === file ? 'selected' : ''}>${escape(path)}</option>`).join(''); setEditor(); refreshActions(); $('recover-draft').hidden = !sessionStorage.getItem(`scada-draft:${demo ? 'demo' : 'server'}`); }
function setEditor() { loadingEditor = true; editor.setState(EditorState.create({ doc: files[file] ?? '', extensions: [basicSetup, javascript({ typescript: true }), EditorView.updateListener.of(update => { if (update.docChanged && !loadingEditor) {
            files[file] = update.state.doc.toString();
            dirty = true;
            validDraft = false;
            $('draft-state').textContent = 'Несохранённый черновик';
            try {
                sessionStorage.setItem(`scada-draft:${demo ? 'demo' : 'server'}`, JSON.stringify({ files, head, file }));
                $('recover-draft').hidden = false;
            }
            catch { }
            refreshActions();
        } })] })); loadingEditor = false; $('draft-state').textContent = dirty ? 'Несохранённый черновик' : `Сохранено · ${String(head).slice(0, 16)}`; }
function validate() { try {
    compileProject(files);
    validDraft = true;
    $('diagnostics').textContent = 'Все модули, сигналы, правила и расписания корректны.';
    $('diagnostics').style.color = '#167568';
    return true;
}
catch (e) {
    validDraft = false;
    $('diagnostics').textContent = e instanceof Error ? e.message : String(e);
    $('diagnostics').style.color = '#a44537';
    return false;
} }
async function setupPwa() {
    const manifest = document.querySelector<HTMLLinkElement>('link[rel=manifest]')!;
    manifest.href = demo ? new URL('manifest.webmanifest', location.href).href : new URL('manifest.webmanifest', base).href;
    if ('serviceWorker' in navigator) {
        registration = await navigator.serviceWorker.register(new URL('sw.js', base), { scope: base.pathname });
        const offer = () => { if (registration?.waiting && navigator.serviceWorker.controller)
            $('update').hidden = false; };
        offer();
        registration.addEventListener('updatefound', () => registration?.installing?.addEventListener('statechange', offer));
        let reload = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => { if (reload)
            return; reload = true; if ($('update').dataset.accepted === 'yes')
            location.reload(); });
    }
}
async function enableNotifications() {
    if (!('Notification' in window) || !registration)
        throw new Error('Уведомления недоступны. На iPhone установите PWA на домашний экран и откройте её оттуда.');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted')
        throw new Error('Разрешение на уведомления не выдано');
    await navigator.serviceWorker.ready;
    if (demo) {
        noticeEnabled = true;
        toast('Демо: локальные уведомления включены, пока открыта симуляция.');
        return;
    }
    const current = await client.request<Status>('session');
    if (!current.push)
        throw new Error('На сервере не задан SCADA_PUSH_SUBJECT');
    const key = current.push.publicKey.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(key), c => c.charCodeAt(0));
    const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
    await client.request('subscribe', subscription.toJSON());
    toast('Web Push включён для пользователя на этом устройстве. Выход из текущей сессии отзывает подписку.');
}
async function start(memory = false) {
    closed = false;
    client = demo ? new LocalClient() : new RemoteClient();
    client.onFrame = renderFrame;
    client.onFailure = message => { failed = true; error(message); refreshActions(); if (frame) {
        const unknown = structuredClone(frame);
        for (const sample of Object.values(unknown.samples)) {
            sample.value = null;
            sample.quality = 'offline';
        }
        const health = status.healthy;
        status.healthy = false;
        renderFrame(unknown);
        status.healthy = health;
    } };
    client.onNotification = n => { if (demo && noticeEnabled && registration && Notification.permission === 'granted')
        void registration.showNotification(n.kind === 'alarm' ? 'SCADA · Аларм' : 'SCADA · Отчёт готов', { body: 'Откройте демонстрацию для подробностей.', tag: n.id, data: { url: new URL('demo/', base).href } }); };
    try {
        status = await client.start(memory);
        frame = status.frame;
        head = status.head;
        failed = false;
        $('error').hidden = true;
        $('loading').hidden = true;
        $('application').hidden = false;
        $('mode').textContent = demo ? 'СИМУЛЯЦИЯ · БЕЗ СЕРВЕРА' : 'СИМУЛЯЦИЯ · NODE.JS';
        $('storage').textContent = demo ? memory ? 'SQLite WASM · память, без сохранения' : 'SQLite WASM · OPFS · одна вкладка-владелец' : 'Node.js · SQLite · Git · авторизованная сессия';
        $('logout').hidden = demo;
        installEquipment();
        scene = new SceneView($('diagram') as unknown as SVGSVGElement);
        scene.onSelect = selectEquipment;
        scene.onGroupFocus = focusSystem;
        editor = new EditorView({ parent: $('editor'), state: EditorState.create({ doc: '' }) });
        setupProject();
        renderFrame(frame);
        const engineering = status.actor.role === 'engineer', operator = status.actor.role !== 'viewer';
        document.querySelector<HTMLElement>('[data-tab=project]')!.hidden = !engineering;
        $('restart').hidden = !engineering;
        $('pause').hidden = !operator;
        if (engineering)
            await loadFiles();
        if (['alarms', 'reports', 'events'].includes(location.hash.slice(1)))
            document.querySelector<HTMLButtonElement>(`[data-tab="${location.hash.slice(1)}"]`)?.click();
        void guard(setupPwa);
    }
    catch (e) {
        $('loading').querySelector('p')!.textContent = e instanceof Error ? e.message : String(e);
        $('memory').hidden = !demo;
        client.close();
    }
}
$('recover-draft').onclick = () => void guard(() => { const saved = JSON.parse(sessionStorage.getItem(`scada-draft:${demo ? 'demo' : 'server'}`) ?? 'null'); if (!saved?.files)
    throw new Error('Нет сохранённого черновика'); validateFiles(saved.files); files = saved.files; head = saved.head; file = saved.file in files ? saved.file : Object.keys(files)[0]; dirty = true; validDraft = false; populateFiles(); setEditor(); refreshActions(); toast('Черновик восстановлен с исходной базовой ревизией.'); });
$('new-file').onclick = () => void guard(() => { const path = prompt('Имя нового модуля, например sensors.ts'); if (!path)
    return; if (path in files)
    throw new Error('Файл уже существует'); validateFiles({ ...files, [path]: '' }); files[path] = ''; file = path; dirty = true; validDraft = false; populateFiles(); setEditor(); refreshActions(); });
$('import-project').onclick = () => $('project-upload').click();
$('project-upload').onchange = () => void guard(async () => { const input = $<HTMLInputElement>('project-upload'), upload = input.files?.[0]; if (!upload)
    return; if (upload.size > 2000000)
    throw new Error('Проект больше 2 MB'); const incoming = JSON.parse(await upload.text()); validateFiles(incoming); if (dirty && !confirm('Заменить текущий черновик?'))
    return; files = incoming; dirty = true; validDraft = false; file = 'plant.ts'; populateFiles(); setEditor(); validate(); refreshActions(); input.value = ''; });
function populateFiles() { $('file').innerHTML = Object.keys(files).map(path => `<option ${path === file ? 'selected' : ''}>${escape(path)}</option>`).join(''); }
$('memory').onclick = () => void start(true);
$('notifications').onclick = () => void guard(enableNotifications);
$('install').onclick = () => void guard(async () => { await pendingInstall?.prompt(); $('install').hidden = true; });
$('update').onclick = () => { if (dirty && !confirm('Обновить приложение? Сначала сохраните или экспортируйте черновик.'))
    return; $('update').dataset.accepted = 'yes'; registration?.waiting?.postMessage({ type: 'ACTIVATE' }); };
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); pendingInstall = e; $('install').hidden = false; });
$('logout').onclick = () => void guard(async () => { await client.request('logout', {}); client.close(); sessionStorage.removeItem('scada-draft:server'); location.href = new URL('login', base).href; });
$('pause').onclick = () => void guard(() => command(frame.paused ? 'resume' : 'pause'));
$('restart').onclick = () => void guard(async () => { if (!confirm('Начать новый прогон с исходными параметрами? Архив и отчёты сохранятся.'))
    return; await client.request('restart', {}); await refreshStatus(); });
$('fit').onclick = () => focusSystem('');
$('zoom-in').onclick = () => viewMode === '3d' ? scene3d?.zoom(.8) : scene.zoom(.8);
$('zoom-out').onclick = () => viewMode === '3d' ? scene3d?.zoom(1.25) : scene.zoom(1.25);
$('diagram').addEventListener('click', e => { if((e.target as Element).closest('[data-port]'))return; const target = (e.target as Element).closest('[data-node]'); if (target) selectEquipment(target.getAttribute('data-node')); });
$('diagram').addEventListener('wheel', e => { e.preventDefault(); scene?.zoom(e.deltaY > 0 ? 1.08 : .92); }, { passive: false });
let pan: {
    x: number;
    y: number;
    camera: SceneView['camera'];
} | null = null;
$('diagram').addEventListener('pointerdown', e => { if ((e.target as Element).closest('[data-node], [data-group] [role=button]'))
    return; pan = { x: e.clientX, y: e.clientY, camera: { ...scene.camera } }; $('diagram').setPointerCapture(e.pointerId); });
$('diagram').addEventListener('pointermove', e => { if (!pan)
    return; const a = scene.point(e.clientX, e.clientY), b = scene.point(pan.x, pan.y); scene.setCamera({ ...pan.camera, x: pan.camera.x - (a.x - b.x), y: pan.camera.y - (a.y - b.y) }); });
$('diagram').addEventListener('pointerup', () => pan = null);
$('file').onchange = () => { file = $<HTMLSelectElement>('file').value; setEditor(); };
$('validate').onclick = () => validate();
$('reload-project').onclick = () => void guard(loadFiles);
$('commit').onclick = () => void guard(async () => { if (!validate())
    return; const message = $<HTMLInputElement>('commit-message').value; if (!message.trim())
    throw new Error('Добавьте описание изменения'); const revision = await client.request<Revision>('save', { files, expected: head, message }); head = revision.id; dirty = false; sessionStorage.removeItem(`scada-draft:${demo ? 'demo' : 'server'}`); $('recover-draft').hidden = true; setEditor(); await refreshStatus(); await refreshPanel(); toast('Commit сохранён. Публикация — отдельное действие.'); });
$('publish').onclick = () => void guard(async () => { if (dirty || !head)
    throw new Error('Сначала сохраните черновик'); await client.request('publish', { revision: head, expected: status.desired }); await refreshStatus(); await refreshPanel(); toast('Проверенная ревизия опубликована.'); });
$('export').onclick = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(files, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'scada-project.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
document.addEventListener('click', e => {
    const button = (e.target as Element).closest<HTMLElement>('button');
    if (!button)
        return;
    const d = button.dataset;
    if(d.viewCommand)void guard(async()=>{
        const v=studioViewList(studioProject()).find(v=>v.id===$<HTMLSelectElement>('view-select').value);
        const action=v&&presentationActions(v).find(a=>a.target===d.viewCommand&&a.value===Number(d.viewSet));
        if(!action)throw new Error('Unknown presentation action');
        await command('operate',{target:action.target,value:action.value});
    });
    if (d.operate) void guard(async () => { const input = document.querySelector<HTMLInputElement>(`[data-control-input="${CSS.escape(d.operate!)}"]`)!; await command('operate', { target: d.operate, value: Number(input.value) }); toast('Уставка принята. Фактический сигнал изменяется с заданной скоростью.'); });
    if (d.focusSystem) { document.querySelector<HTMLButtonElement>('[data-tab=scheme]')!.click(); focusSystem(d.focusSystem); }
    if (d.inspect) { const node = status.project.devices.find(n => n.id === d.inspect); if (node) { document.querySelector<HTMLButtonElement>('[data-tab=scheme]')!.click(); selectEquipment(node.id); focusSystem(node.system); } }
    if (d.tab) {
        tab = d.tab;
        document.querySelectorAll<HTMLElement>('[data-panel]').forEach(p => p.hidden = p.dataset.panel !== tab);
        document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.tab === tab));
        if (tab === 'scheme') { /* Preserve the current installation camera across tabs. */ }
        void guard(refreshPanel);
    }
    if ('refresh' in d)
        void guard(refreshPanel);
    if (d.set)
        void guard(async () => { const input = document.querySelector<HTMLInputElement>(`[data-param="${CSS.escape(d.set!)}"]`)!; await command('set', { target: selected, parameter: d.set, value: Number(input.value) }); toast('Параметр применён к текущему прогону.'); });
    if (d.ack)
        void guard(() => command('ack', { target: d.ack }));
    if (d.run)
        void guard(async () => { const inputs = Object.fromEntries([...document.querySelectorAll<HTMLInputElement>(`[data-report="${CSS.escape(d.run!)}"]`)].map(i => [i.dataset.input, Number(i.value)])); await client.request('report', { reportId: d.run, inputs }); await refreshPanel(); toast('Отчёт поставлен в очередь.'); });
    if (d.artifact)
        void guard(async () => { const result = await client.request<ReportArtifact>('report-artifact', { id: d.artifact }); const preview = $<HTMLIFrameElement>('report-preview'); preview.srcdoc = result.html; preview.hidden = false; preview.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    if (d.rollback)
        void guard(async () => { if (dirty)
            throw new Error('Сначала сохраните или экспортируйте черновик'); if (!confirm('Создать новую ревизию с содержимым выбранной версии и опубликовать её?'))
            return; await client.request('rollback', { revision: d.rollback, expected: head }); await refreshStatus(); await loadFiles(); await refreshPanel(); });
});
window.addEventListener('beforeunload', e => { if (dirty) {
    e.preventDefault();
    e.returnValue = '';
} });
setInterval(() => { if (!status || failed || closed)
    return; if (tab === 'reports' || tab === 'events')
    void guard(refreshPanel); void updateTrend(); }, 3000);

function selectEquipment(id: string | null) {
    selected = id; scene.select(id); scene3d?.select(id); drawDependencies(); renderInspector();
}
async function setView(mode: '2d' | '3d') {
    if (changingView || mode === viewMode) return;
    changingView = true;
    try {
        if (mode === '3d' && !scene3d) {
            const { SceneView3D } = await import('../../src/view3d');
            $('scene3d').hidden = false;
            try { scene3d = new SceneView3D($('scene3d')); }
            catch (e) { $('scene3d').hidden = true; throw new Error(`3D не запустился: ${e instanceof Error ? e.message : String(e)}. 2D продолжает работать.`); }
            scene3d.onSelect = selectEquipment;
            scene3d.onPortSelect = (device,port)=>void guard(()=>chooseTerminal({device,port}));
            scene3d.onOverview = () => focusSystem('');
        }
        viewMode = mode; $('diagram').hidden = mode === '3d'; $('scene3d').hidden = mode !== '3d';
        for (const m of ['2d', '3d']) $(`view-${m}`).setAttribute('aria-pressed', String(m === mode));
        if (scene3d && mode === '3d') {
            scene3d.render(scene.scene); scene3d.setRuntime(visualFrame(status.project, frame)); scene3d.select(selected); focusSystem(system); drawDependencies();
        } else { scene.focusGroup(system || null); }
    } finally { changingView = false; }
}
function renderControls() {
    const controls = status.project.controls ?? [];
    const groups = [...new Set(controls.map(c => c.system))];
    $('control-list').innerHTML = groups.map(id => {
        const system = status.project.systems.find(s => s.id === id)!;
        const observations = status.project.devices.filter(d => d.system === id).slice(0, 6).flatMap(d => {
            const first = Object.entries(d.signals)[0];
            return first && typeof first[1] === 'object' && 'ref' in first[1] ? [{id:d.id,key:first[1].ref}] : [];
        });
        return `<section class="control-system"><div class="card-header"><h3>${escape(system.title)}</h3><button data-focus-system="${escape(id)}">На схеме</button></div>
            <div class="control-observations">${observations.map(o => `<div><span>${escape(o.id)}</span><b data-control-observation="${escape(o.key)}">—</b><small>${escape(o.key)}</small></div>`).join('')}</div>
            <div class="control-grid">${controls.filter(c=>c.system===id).map(c => `<article class="control-card" data-control="${escape(c.id)}">
      <p class="eyebrow">${escape(status.project.systems.find(s => s.id === c.system)?.title ?? c.system)}</p>
      <h3>${escape(c.title)}</h3><p class="control-id">${escape(c.id)}.value · ${escape(c.unit)}</p>
      <div class="control-readouts"><span>Уставка <b data-demand>—</b></span><span>Фактически <b data-actual>—</b></span></div>
      <meter min="${c.min}" max="${c.max}" value="${c.initial}"></meter>
      <label class="control-edit">Новая уставка<input type="number" aria-label="${escape(c.title)}" data-control-input="${escape(c.id)}" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.initial}"><button data-operate="${escape(c.id)}">Применить</button></label>
      <p>${c.min}…${c.max} ${escape(c.unit)} · скорость до ${c.rate} /с</p><p class="control-gate" data-gate role="status"></p>
    </article>`).join('')}</div></section>`;
    }).join('') || '<p>В этом проекте управляющие сигналы не объявлены.</p>';
    refreshControls();
    const plcScreen=document.querySelector<SVGSVGElement>('#plc-front .runtime-hmi');if(plcScreen&&selected)drawHmiSvg(plcScreen,selected);
}
function refreshControls() {
    if (!status || !frame) return;
    for (const e of document.querySelectorAll<HTMLElement>('[data-control-observation]')) { const sample=frame.samples[e.dataset.controlObservation!]; e.textContent=fmt(sample?.quality==='good'?sample.value:null); }
    for (const c of status.project.controls ?? []) {
        const node = document.querySelector<HTMLElement>(`[data-control="${CSS.escape(c.id)}"]`); if (!node) continue;
        const actual = frame.samples[`${c.id}.value`], requested = frame.samples[`${c.id}.requested`];
        node.querySelector('[data-actual]')!.textContent = fmt(actual?.quality === 'good' ? actual.value : null);
        node.querySelector('[data-demand]')!.textContent = fmt(requested?.quality === 'good' ? requested.value : null);
        const healthy = !failed && actual?.quality === 'good';
        const blocked = !!frame.samples[`${c.id}.blocked`]?.value;
        node.querySelector('meter')!.value = healthy ? actual.value ?? c.min : c.min;
        (node.querySelector('[data-operate]') as HTMLButtonElement).disabled = !healthy || blocked || status.actor.role === 'viewer';
        node.dataset.blocked = String(blocked);
        node.querySelector('[data-gate]')!.textContent = !healthy ? 'Данные недостоверны: команды заблокированы.' : blocked ? c.blockedReason ?? 'Блокировка активна' : c.enableWhen ? 'Разрешающие условия выполнены' : 'Диапазон учебной модели';
    }
}
function renderInventory() {
    if (!status) return;
    const q = $<HTMLInputElement>('equipment-search').value.toLocaleLowerCase('ru');
    const entries=status.project.devices.map(d=>{
        const n=status.project.simulations.find(n=>n.id===d.id),m=n&&model(n.model);
        const c=status.project.controllers?.find(c=>c.id===d.id);
        return {device:d,title:m?.title??'Saturn PLC · FBD/WASM',version:m?`${n!.model} / ${m.version}`:'saturn-fbd/combinational-v1',inputs:n?Object.keys(n.inputs).length:Object.keys(terminals('saturn')).filter(k=>/^DI|^AI/.test(k)).length,outputs:m?Object.keys(m.outputs).length:Object.keys(c?.outputs??{}).length};
    }).filter(e=>`${e.device.id} ${e.title} ${e.device.system}`.toLocaleLowerCase('ru').includes(q));
    $('coverage').textContent = `${status.project.devices.length} приборов · ${status.project.controllers?.length??0} PLC · ${status.project.systems.length} подсистем · ${status.project.connections?.length??0} физических соединений. Учебная комплектация, не проверенная ведомость АЭС.`;
    $('inventory-list').innerHTML = `<div class="table-scroll"><table><thead><tr><th>Прибор</th><th>Подсистема</th><th>Модель / версия</th><th>Входы → выходы</th><th>Представления</th></tr></thead><tbody>${entries.map(e=>`<tr><td><button data-inspect="${escape(e.device.id)}">${escape(e.device.id)}</button></td><td>${escape(status.project.systems.find(s=>s.id===e.device.system)?.title??e.device.system)}</td><td>${escape(e.title)}<br><small>${escape(e.version)}</small></td><td>${e.inputs} → ${e.outputs}</td><td>2D / 3D · ${e.device.type==='saturn'?'SVG/HMI + WASM':'схема'}</td></tr>`).join('')}</tbody></table></div>`;
}
$('view-2d').onclick = () => void guard(() => setView('2d'));
$('diagram').addEventListener('keydown', e => { if (e.key.toLowerCase() === 'f') { e.preventDefault(); focusSystem(''); } });
$('view-3d').onclick = () => void guard(() => setView('3d'));
$('equipment-search').oninput = renderInventory;
window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); });
window.addEventListener('pagehide', () => { closed = true; scene3d?.dispose(); client?.close(); });

void start();

function studioViewList(project:any){let auto=autoHmiCache.get(project);if(!auto){auto=deriveHmi(project);autoHmiCache.set(project,auto);}return [auto,...(project.views??[])];}
function setupViews(){
    const style=$('presentation-style');style.textContent=presentationCss;
    const project=studioProject(),viewList=studioViewList(project);
    const select=$<HTMLSelectElement>('view-select'),previous=select.value;
    select.replaceChildren(...viewList.map(v=>{const o=document.createElement('option');o.value=v.id;o.textContent=v.id==='auto-hmi'?'Авто · '+v.title:v.title;return o;}));
    if([...select.options].some(o=>o.value===previous))select.value=previous;
    select.onchange=()=>{const view=viewList.find(v=>v.id===select.value);liveHmiScreen=view?.initial??presentationScreens(view!)[0]?.id??'';refreshView(true);};
    const view=viewList.find(v=>v.id===select.value);if(view&&!liveHmiScreen)liveHmiScreen=view.initial??presentationScreens(view)[0].id;
    renderHmiScreenTabs(view);
    const reports=$<HTMLSelectElement>('report-studio-select'),reportPrevious=reports.value;
    reports.replaceChildren(...project.reports.map(r=>{const o=document.createElement('option');o.value=r.id;o.textContent=r.title;return o;}));
    if([...reports.options].some(o=>o.value===reportPrevious))reports.value=reportPrevious;
    else if([...reports.options].some(o=>o.value==='bench-state'))reports.value='bench-state';
    reports.onchange=()=>void refreshReportStudio(true);
    refreshView(true);
}
function studioProject(){if(dirty&&validDraft){try{return compileProject(files);}catch{}}return status.project;}
function markStudioDraft(path:string){
    file=path;dirty=true;validDraft=false;$('draft-state').textContent='Несохранённый черновик';
    try{sessionStorage.setItem(`scada-draft:${demo?'demo':'server'}`,JSON.stringify({files,head,file}));$('recover-draft').hidden=false;}catch{}
    refreshActions();
}
function studioEditor(kind:'view'|'report',path:string,range?:StudioSource|null){
    const host=$(kind==='view'?'view-code':'report-code');
    if(!files[path]){host.textContent='Исходники доступны инженеру после загрузки проекта.';return;}
    studioFiles[kind]=path;
    const extensions=[basicSetup,javascript({typescript:true}),EditorView.updateListener.of(update=>{
        if(!update.docChanged||studioLoading)return;
        files[studioFiles[kind]!] = update.state.doc.toString();markStudioDraft(studioFiles[kind]!);
        window.clearTimeout((studioEditor as any)[kind]);(studioEditor as any)[kind]=window.setTimeout(()=>{
            try{compileProject(files);validDraft=true;refreshActions();setupViews();if(kind==='report')void refreshReportStudio(true);}
            catch(e){validDraft=false;toast(e instanceof Error?e.message:String(e));}
        },250);
    })];
    if(!studioEditors[kind])studioEditors[kind]=new EditorView({parent:host,state:EditorState.create({doc:files[path],extensions})});
    else {studioLoading=true;studioEditors[kind]!.setState(EditorState.create({doc:files[path],extensions}));studioLoading=false;}
    if(range){studioEditors[kind]!.dispatch({selection:{anchor:range.from,head:range.to},scrollIntoView:true});}
    $(kind==='view'?'view-code-file':'report-code-file').textContent=path;
    $(kind==='view'?'view-code-range':'report-code-range').textContent=range?lineLabel(range):'Источник DSL';
}
function renderHmiScreenTabs(view:any){
    const tabs=$('view-screen-tabs');if(!view){tabs.replaceChildren();return;}
    const screens=presentationScreens(view);if(!screens.some(s=>s.id===liveHmiScreen))liveHmiScreen=view.initial??screens[0].id;
    tabs.innerHTML=screens.map(s=>`<button data-studio-screen="${escape(s.id)}" class="${s.id===liveHmiScreen?'active':''}">${escape(s.title)}</button>`).join('');
    tabs.querySelectorAll<HTMLButtonElement>('[data-studio-screen]').forEach(b=>b.onclick=()=>{liveHmiScreen=b.dataset.studioScreen!;refreshView(true);});
}
function refreshView(rebuild=false){
    const project=studioProject(),select=$<HTMLSelectElement>('view-select');
    const view=studioViewList(project).find(v=>v.id===select.value),host=$('live-view');
    if(!view){host.textContent='Объявите view() в DSL проекта.';return;}
    const values=bindPresentation(view,frame.samples,frame.time),interactive=!failed&&status.actor.role!=='viewer';
    if(rebuild||host.dataset.definition!==JSON.stringify(view)+liveHmiScreen){host.innerHTML=renderPresentation(view,{values,interactive,screen:liveHmiScreen});host.dataset.definition=JSON.stringify(view)+liveHmiScreen;}
    for(const node of host.querySelectorAll<HTMLElement>('[data-view-value]')){const sample=values[node.dataset.viewValue!],valid=sample?.quality==='good'&&sample.value!==null;node.textContent=valid?sample.value!.toFixed(Number(node.dataset.digits??2)):'—';node.parentElement!.dataset.quality=valid?'good':'bad';node.parentElement!.querySelector('small')!.textContent=(node.dataset.unit??'')+(valid?'':' · нет достоверных данных');}
    for(const button of host.querySelectorAll<HTMLButtonElement>('[data-view-command]'))button.disabled=!interactive;
    for(const button of host.querySelectorAll<HTMLButtonElement>('[data-view-screen]')){button.disabled=!interactive;button.onclick=e=>{e.stopPropagation();liveHmiScreen=button.dataset.viewScreen!;refreshView(true);};}
    applyPresentationMotion(host,values);
    renderHmiScreenTabs(view);
    bindStudioCanvas('view',host,'views.ts');
    if(!studioEditors.view&&files['views.ts'])studioEditor('view','views.ts');
}
async function refreshReportStudio(rebuild=false){
    if(!status||!frame)return;
    const project=studioProject(),select=$<HTMLSelectElement>('report-studio-select'),report=project.reports.find(r=>r.id===select.value),host=$('report-visual');
    if(!report){host.textContent='Выберите отчёт.';return;}
    if(!report.view){host.innerHTML=`<div class="studio-empty"><b>${escape(report.title)}</b><p>Этот отчёт использует SQL/колонки без presentation view. Добавьте view:, чтобы редактировать компоновку визуально.</p></div>`;if(!studioEditors.report&&files['reports.ts'])studioEditor('report','reports.ts');return;}
    let rows:Record<string,unknown>[]=[];
    try{const data=await client.request<ReportData>('history',{signals:report.signals,from:Math.max(0,frame.time-report.window),to:frame.time});rows=data.samples as unknown as Record<string,unknown>[];}catch{}
    const values=bindPresentation(report.view,frame.samples,frame.time);
    host.innerHTML=renderPresentation(report.view,{values,rows,interactive:false});
    bindStudioCanvas('report',host,'reports.ts');
    if(!studioEditors.report&&files['reports.ts'])studioEditor('report','reports.ts');
}
function applyPresentationMotion(host:HTMLElement,values:Record<string,any>){
    for(const node of host.querySelectorAll<HTMLElement>('[data-view-motion]')){
        const sample=values[node.dataset.viewMotion!],value=sample?.quality==='good'&&typeof sample.value==='number'?sample.value:null;
        const min=Number(node.dataset.motionMin),max=Number(node.dataset.motionMax),from=Number(node.dataset.motionFrom),to=Number(node.dataset.motionTo);
        const t=value===null?0:Math.max(0,Math.min(1,(value-min)/(max-min))),v=from+(to-from)*t;
        node.style.removeProperty('animation');
        switch(node.dataset.motionProperty){
            case 'opacity':node.style.opacity=String(v);node.style.transform='';break;
            case 'scale':node.style.transform=`scale(${v})`;node.style.opacity='';break;
            case 'rotate':node.style.transform=`rotate(${v}deg)`;node.style.opacity='';break;
            case 'pulse':node.style.animation=value!==null&&t>.5?`pv-pulse ${Math.max(.35,1.4-v*.8)}s ease-in-out infinite`:'none';break;
        }
    }
}
function bindStudioCanvas(kind:'view'|'report',host:HTMLElement,preferredFile:string){
    host.querySelectorAll<HTMLElement>('[data-studio-kind]').forEach(node=>{
        node.onclick=e=>{e.stopPropagation();selectStudioNode(kind,node,preferredFile);};
        node.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectStudioNode(kind,node,preferredFile);}};
    });
}
function selectStudioNode(kind:'view'|'report',node:HTMLElement,preferredFile:string){
    const host=kind==='view'?$('live-view'):$('report-visual');host.querySelectorAll('[data-studio-selected]').forEach(n=>n.removeAttribute('data-studio-selected'));node.dataset.studioSelected='true';
    const nodeKind=node.dataset.studioKind as any,index=Number(node.dataset.studioIndex),source=node.dataset.studioHint?textSource(files,node.dataset.studioHint):widgetSource(files,preferredFile,nodeKind,index);
    studioSelection[kind]={kind:nodeKind,index,source};
    if(source)studioEditor(kind,source.file,source);
    renderStudioProperties(kind,node,source);
}
function renderStudioProperties(kind:'view'|'report',node:HTMLElement,source:StudioSource|null){
    const host=$(kind==='view'?'view-properties':'report-properties'),k=node.dataset.studioKind!;
    const value=(sel:string)=>node.querySelector<HTMLElement>(sel)?.textContent?.trim()??'';
    let fields='';
    if(k==='text')fields=studioField('text','Текст',node.textContent?.trim()??'');
    if(k==='value')fields=studioField('label','Заголовок',value('span'))+studioField('unit','Единица',node.querySelector<HTMLElement>('strong')?.dataset.unit??'')+studioField('digits','Знаков',node.querySelector<HTMLElement>('strong')?.dataset.digits??'2','number');
    if(k==='chart')fields=studioField('title','Заголовок',value('figcaption'));
    if(k==='action')fields=studioField('label','Текст кнопки',node.textContent?.trim()??'')+studioField('value','Значение команды',node.dataset.viewSet??'0','number');
    if(k==='navigate')fields=studioField('label','Текст перехода',node.textContent?.trim()??'');
    const firmware=kind==='view'?textSource(files,"plc('SATURN-1'",'commissioning.ts'):null;
    host.innerHTML=`<p class="eyebrow">СВОЙСТВА ВИДЖЕТА</p><h3>${escape(k.toUpperCase())}</h3>${fields||'<p class="studio-empty">Структурный виджет редактируется кодом.</p>'}<h3>Связанные исходники</h3>${source?sourceLink(kind,source,'DSL'):''}${firmware?sourceLink(kind,firmware,'PLC · прошивка'):''}<p class="studio-save-note">Визуальная правка меняет TypeScript-черновик. Runtime не изменится до commit + публикации.</p>`;
    host.querySelectorAll<HTMLInputElement>('[data-studio-field]').forEach(input=>input.onchange=()=>void guard(()=>applyStudioField(kind,input.dataset.studioField!,input.type==='number'?Number(input.value):input.value)));
    host.querySelectorAll<HTMLButtonElement>('[data-source-file]').forEach(button=>button.onclick=()=>{const src=button.dataset.sourceFile===source?.file?source:firmware;if(src)studioEditor(kind,src.file,src);});
}
function studioField(name:string,title:string,value:string,type='text'){return `<label>${escape(title)}<input data-studio-field="${name}" type="${type}" value="${escape(value)}"></label>`;}
function sourceLink(kind:'view'|'report',source:StudioSource,label:string){return `<div class="source-link"><span>${escape(label)} · ${escape(lineLabel(source))}</span><button data-source-file="${escape(source.file)}">К коду</button></div>`;}
function applyStudioField(kind:'view'|'report',field:string,value:string|number){
    const selection=studioSelection[kind];if(!selection?.source)throw new Error('Исходный диапазон не найден');
    files=patchWidget(files,selection.source,field,value);markStudioDraft(selection.source.file);
    const project=compileProject(files);validDraft=true;refreshActions();
    studioLoading=true;studioEditor(kind,selection.source.file);studioLoading=false;
    setupViews();if(kind==='report')void refreshReportStudio(true);toast('TypeScript обновлён. Сохраните commit, когда результат готов.');
}
$('view-build').onclick=()=>void guard(async()=>{const artifact=await client.request<any>('firmware',{controllerId:'SATURN-1',revision:frame.revision});toast(`Собрано: ${artifact.bytes??artifact.fbdbin?.length??0} байт · без загрузки в физический PLC`);});
$('view-simulate').onclick=()=>toast('HMI показывает текущий детерминированный runtime.');
$('report-run-now').onclick=()=>void guard(async()=>{const id=$<HTMLSelectElement>('report-studio-select').value;await client.request('report',{reportId:id,inputs:{}});await refreshPanel();toast('Отчёт поставлен в очередь.');});
$('report-preview-pdf').onclick=()=>toast('Визуальный canvas использует тот же presentation tree, что HTML/PDF-артефакт.');
