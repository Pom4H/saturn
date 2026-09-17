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
function renderInspector() {
    $('inspector').hidden = !selected;
    document.querySelector('.workspace')!.classList.toggle('has-selection', !!selected);
    if (!selected) {
        $('inspector').innerHTML = '<h2>Оборудование</h2><p>Выберите компонент на схеме. Входы могут поступать из любой подсистемы.</p>';
        return;
    }
    const n = status.project.simulations.find(n => n.id === selected);
    if (!n) {
        $('inspector').textContent = selected;
        return;
    }
    const spec = model(n.model);
    $('inspector').innerHTML = `<p class="eyebrow">${escape(n.model)} / ${escape(spec.version)}</p><h2>${escape(n.id)}</h2><p>${escape(spec.title)}</p><div class="signals">${Object.entries(spec.outputs).map(([key, unit]) => `<div class="signal-row" data-signal="${escape(n.id + '.' + key)}"><span title="${escape(unit)}">${escape(key)}</span><b>—</b></div>`).join('')}</div><svg id="small-trend" class="trend" viewBox="0 0 400 130"></svg><div class="parameters"><h3>Параметры модели</h3><p>Изменения — команды текущего прогона; исходник проекта не меняется.</p>${Object.entries(spec.parameters).map(([key, d]) => `<label class="parameter"><span>${escape(key)}</span><input type="number" data-param="${escape(key)}" value="${status.overrides[`${n.id}.${key}`] ?? n.parameters[key]}" min="${d.min}" max="${d.max}" step="any"><button data-set="${escape(key)}" ${status.actor.role !== 'engineer' ? 'disabled' : ''} title="Применить">↵</button></label>`).join('')}</div><p class="model-limit">Условная модель. Числа не являются настройками реального оборудования.</p>`;
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
$('diagram').addEventListener('click', e => { const target = (e.target as Element).closest('[data-node]'); if (target) selectEquipment(target.getAttribute('data-node')); });
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
    const rows = status.project.simulations.filter(n => `${n.id} ${model(n.model).title} ${n.system}`.toLocaleLowerCase('ru').includes(q));
    $('coverage').textContent = `${status.project.simulations.length} приборов · ${new Set(status.project.simulations.map(n => n.model)).size} моделей · ${status.project.systems.length} подсистем · ${status.project.controls?.length ?? 0} управляющих сигналов. Все модели учебные, без валидации по реальной АЭС.`;
    $('inventory-list').innerHTML = `<div class="table-scroll"><table><thead><tr><th>Прибор</th><th>Подсистема</th><th>Модель / версия</th><th>Входы → выходы</th><th>Представления</th></tr></thead><tbody>${rows.map(n => { const m = model(n.model); return `<tr><td><button data-inspect="${escape(n.id)}">${escape(n.id)}</button></td><td>${escape(status.project.systems.find(s => s.id === n.system)?.title ?? n.system)}</td><td>${escape(m.title)}<br><small>${escape(n.model)} / ${escape(m.version)}</small></td><td>${Object.keys(n.inputs).length} → ${Object.keys(m.outputs).length}</td><td>2D / 3D · схема</td></tr>`; }).join('')}</tbody></table></div>`;
}
$('view-2d').onclick = () => void guard(() => setView('2d'));
$('diagram').addEventListener('keydown', e => { if (e.key.toLowerCase() === 'f') { e.preventDefault(); focusSystem(''); } });
$('view-3d').onclick = () => void guard(() => setView('3d'));
$('equipment-search').oninput = renderInventory;
window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); });
window.addEventListener('pagehide', () => { closed = true; scene3d?.dispose(); client?.close(); });

void start();
