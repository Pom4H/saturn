import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, undo, redo, undoDepth, redoDepth, indentWithTab, isolateHistory } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { bracketMatching, foldGutter, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { autocompletion, closeBrackets } from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';
import { setDiagnostics } from '@codemirror/lint';
import { compile, patchFields, editable, appendEquipment, appendConnection, appendTap, removeObject, SourceError, type Compiled } from '../src/source';
import { catalog, type Endpoint, type Value } from '../src/core';
import { dslCompletions } from '../src/completion';
import { SceneView } from '../src/view';
import { createGlyphSvg } from '../src/elements/symbols';
import '../src/visual-components';
import type { SceneView3D } from '../src/view3d';
import { examples, emptySource, createWorkspace, parseWorkspace, currentDocument, updateSource, createProject, workspaceKey, type ExampleId, type WorkspaceState } from './shell-projects';

import { SimulationStream, type TelemetryUpdate } from './telemetry';
import type { RuntimeFrame } from '../src/runtime/protocol';
import { FileNavigator } from './navigator';
import { Documents, fetchServerWorkspace, type ServerWorkspaceSnapshot } from './documents';
import { updateFiles } from './shell-projects';
import type { plantProjection } from './plant-project';
import { downloadFile, exportHTML, shareURL, readSharedSource } from './exports';
import { fetchServerSession, serverPost, commandPayload, type ServerSession } from './server-runtime';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
type Surface = 'scene' | 'equipment' | 'source' | 'signals' | 'controls' | 'alarms' | 'projects';
export async function mountStudio() {
  const stage = $('studio'), shell = $('studio-shell'), spatialHost = $('studio-spatial');
  const canvas = document.getElementById('studio-svg') as unknown as SVGSVGElement;
  const inspector = shell.querySelector<HTMLElement>('.studio-inspector')!;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)'), compact = matchMedia('(max-width:520px)');
  let workspace: WorkspaceState = createWorkspace(), storageAvailable = true;
  try { const raw = localStorage.getItem(workspaceKey); if (raw) workspace = parseWorkspace(raw); }
  catch { storageAvailable = false; }
  let shared = false;
  try { const source = readSharedSource(location.hash); if (source) { compile(source); createProject(workspace, 'Проект по ссылке', source); shared = true; } } catch { storageAvailable = false; }
  let compiled: Compiled = compile(examples.pump.source), spatial: SceneView3D | undefined;
  let errorPath: string | null = null;
  let error = false, selected: string | null = null, surface: Surface = 'scene';
  let filesVisible = false;
  let plantTools: typeof import('./plant-project') | undefined, plant: ReturnType<typeof plantProjection> | undefined;
  let workspaceSnapshot: ServerWorkspaceSnapshot | null = null, pendingWorkspaceSnapshot: ServerWorkspaceSnapshot | null = null;
  let serverSession: ServerSession | null = null, runtimeOnly = false, runtimeRevision: string | null = null;
  let documents: Documents;
  let codeVisible = !compact.matches, propertiesVisible = false, mobilePane: 'scene' | 'source' | 'properties' = 'scene';
  let progress = 0, explicit: '2d' | '3d' = compact.matches ? '2d' : '3d', fullscreen = false, scrollBeforeFullscreen = 0;
  let visible = false, paused = reduced.matches, toastTimer = 0;
  let connecting: Endpoint | 'choose' | null = null;
  const view = new SceneView(canvas);
  const editorTheme = EditorView.theme({ '&': { height: '100%', background: 'var(--bg)', color: 'var(--text)', fontSize: '12px' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--mono)' }, '.cm-content': { padding: '16px 0', caretColor: 'var(--text)' }, '.cm-gutters': { background: 'var(--bg)', color: 'var(--muted)', border: 'none' }, '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { background: 'var(--shell-selection)' }, '.cm-activeLine': { background: 'var(--shell-panel)' } }, { dark: true });
  function editorState(source: string, path = 'station.ts') {
    return EditorState.create({ doc: source, extensions: [lineNumbers(), drawSelection(), history(), foldGutter(), highlightActiveLine(), ...(path.endsWith('.ts') || path.endsWith('.json') ? [javascript({ typescript: path.endsWith('.ts') })] : []), bracketMatching(), closeBrackets(), syntaxHighlighting(HighlightStyle.define([{ tag: tags.keyword, color: 'var(--code-keyword)' }, { tag: tags.string, color: 'var(--code-string)' }, { tag: tags.number, color: 'var(--code-number)' }, { tag: tags.comment, color: 'var(--code-comment)' }, { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: 'var(--code-function)' }, { tag: tags.propertyName, color: 'var(--code-property)' }, { tag: tags.variableName, color: 'var(--text)' }])), editorTheme,
      autocompletion({ override: [context => { const word = context.matchBefore(/[\w-]*/); if (isPlant()) return null; if (!word || word.from === word.to && !context.explicit) return null; return { from: word.from, options: dslCompletions(context.state.doc.toString(), context.pos, compiled.scene) }; }] }),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab, { key: 'Mod-s', run: () => { download(); return true; } }]),
      EditorView.contentAttributes.of({ 'aria-label': 'Исходник установки TypeScript', spellcheck: 'false' }),
      EditorView.updateListener.of(update => { documents.capture(update.state); syncHistory(update.state); if (update.docChanged) refresh(true); }),
    ] });
  }
  const initial = currentDocument(workspace);
  documents = new Documents(initial.files ?? { 'station.ts': initial.source }, editorState, initial.files?.['src/plant.ts'] !== undefined ? 'src/plant.ts' : initial.files?.['plant.ts'] !== undefined ? 'plant.ts' : 'station.ts');
  const editor = new EditorView({ parent: $('studio-editor'), state: documents.state });
  function syncHistory(state = editor.state) {
    $('studio-undo').toggleAttribute('disabled', undoDepth(state) === 0);
    $('studio-redo').toggleAttribute('disabled', redoDepth(state) === 0);
  }
  function isPlant() { return documents?.states.has('src/plant.ts') || documents?.states.has('plant.ts') || false; }
  function fitScene() {
    view.fit(); capPlantScale();
  }
  function capPlantScale() {
    if (!isPlant() && !runtimeOnly) return;
    const rect = canvas.getBoundingClientRect(), camera = view.camera;
    const scale = Math.min(rect.width / camera.width, rect.height / camera.height);
    const maxScale = runtimeOnly && compact.matches ? 3.2 : 1.25;
    if (scale > maxScale) view.zoom(scale / maxScale);
  }
  let workspaceDraft: { snapshot: ServerWorkspaceSnapshot; documents: Documents } | null = null;
  let telemetry: TelemetryUpdate = { state: 'connecting', frame: null, message: '' };
  let observedRuntime: RuntimeFrame | null = null;
  const stream = new SimulationStream(update => {
    telemetry = update;
    if (serverSession && update.frame) serverSession = { ...serverSession, frame: update.frame };
    applyTelemetry();
  });
  let serverLoading = false;
  const shortRevision = (value: string | null | undefined) => value ? value.slice(0, 7) : '—';
  function syncProductContext() {
    const source = workspaceSnapshot?.sourceRevision ?? serverSession?.head ?? null;
    const published = serverSession?.desired ?? null;
    const applied = telemetry.frame?.revision ?? runtimeRevision ?? serverSession?.frame.revision ?? null;
    $('revision-source').textContent = source ? shortRevision(source) : workspace.active.kind === 'example' ? 'demo' : 'local';
    $('revision-published').textContent = shortRevision(published);
    $('revision-applied').textContent = shortRevision(applied);
    const drift = Boolean(published && applied && published !== applied);
    const sourceAhead = Boolean(workspaceSnapshot && applied && workspaceSnapshot.id !== applied);
    shell.dataset.revisionState = drift || sourceAhead ? 'drift' : published && applied ? 'synced' : 'local';
    $('revision-chain').title = sourceAhead
      ? 'Workspace собран в другой artifact, чем сейчас применён runtime'
      : drift ? 'Опубликованный и применённый build artifacts различаются'
      : published && applied ? 'Runtime работает на опубликованном build artifact' : 'Локальный инженерный контекст';
    $('environment-name').textContent = serverSession ? (runtimeOnly ? 'Runtime' : 'Workspace') : workspace.active.kind === 'example' ? 'Demo' : 'Local';
  }
  function setServerRole(session: ServerSession | null) {
    serverSession = session;
    if (session) {
      shell.dataset.role = session.actor.role;
      $('server-role').hidden = false;
      $('server-role').textContent = session.actor.role;
      $('server-role').title = `Пользователь ${session.actor.id}`;
    } else {
      delete shell.dataset.role;
      $('server-role').hidden = true;
      $('server-role').textContent = '';
    }
    syncProductContext();
  }
  function syncTelemetry() {
    if ((workspaceSnapshot || runtimeOnly) && plant) stream.start();
    else { stream.stop(); telemetry = { state: 'connecting', frame: null, message: '' }; }
    applyTelemetry();
  }
  function applyTelemetry() {
    if (!plant || !plantTools) { observedRuntime = null; shell.dataset.telemetry = 'local'; shell.dataset.runtimeSeq = ''; renderRuntimeControls(); renderRuntimeAlarms(); return; }
    const liveFrame = telemetry.frame;
    let status: string = runtimeOnly ? telemetry.state : 'draft', label = runtimeOnly ? telemetry.message : 'Черновик · без телеметрии';
    observedRuntime = plant.runtime;
    const revision = runtimeOnly ? (runtimeRevision ?? serverSession?.frame.revision ?? null) : workspaceSnapshot?.id ?? null;
    const sourceClean = runtimeOnly || !documents.dirty() && !error;
    if (revision && sourceClean) {
      status = telemetry.state; label = telemetry.message;
      if (liveFrame && liveFrame.revision !== revision) { status = 'revision'; label = 'Симуляция другой ревизии'; }
      else if (telemetry.state === 'live' && liveFrame) {
        status = liveFrame.paused ? 'paused' : 'live';
        label = liveFrame.paused ? 'Симуляция · пауза' : 'Симуляция · подключена';
        observedRuntime = plantTools.visualFrame(plant.project, liveFrame);
      } else if (telemetry.state === 'stale' && liveFrame) {
        status = 'stale'; label = telemetry.message || 'Связь потеряна · показан последний подтверждённый кадр';
        observedRuntime = plantTools.visualFrame(plant.project, liveFrame);
        for (const equipment of Object.values(observedRuntime.equipment)) for (const signal of Object.values(equipment.signals)) signal.quality = 'stale';
        for (const signal of Object.values(observedRuntime.flows)) signal.quality = 'stale';
      }
    } else if (workspaceSnapshot) label = 'Черновик · данные приостановлены';
    if (!['live','paused','stale'].includes(status)) observedRuntime = plantTools.unavailableRuntime(plant.project, status === 'draft' || status === 'revision' ? 'draft' : 'offline');
    shell.dataset.telemetry = status; shell.dataset.runtimeSeq = String(status === 'live' || status === 'paused' ? liveFrame?.seq ?? '' : '');
    $('studio-context').textContent = label || (runtimeOnly ? 'Установка' : 'Черновик'); $('studio-context').title = telemetry.message || label;
    syncProductContext();
    view.setRuntime(observedRuntime); spatial?.setRuntime(observedRuntime);
    animateState();
    renderRuntimeControls(); renderRuntimeAlarms();
    if (surface === 'signals') renderSignals();
  }
  async function runtimeCommand(action: string, extra: Record<string, unknown> = {}) {
    if (!serverSession || !telemetry.frame || !['live', 'paused'].includes(shell.dataset.telemetry ?? '')) throw new Error('Нет достоверной связи с runtime');
    const current = { ...serverSession, frame: telemetry.frame };
    await serverPost(current, 'command', commandPayload(current, action, extra));
  }
  function renderRuntimeControls() {
    const host = $('runtime-control-list'); host.replaceChildren();
    const project = serverSession?.project, frame = telemetry.frame;
    const controls = project?.controls ?? [];
    $('runtime-controls').hidden = !serverSession;
    $('runtime-state').textContent = serverSession ? `${project!.title} · ${frame?.paused ? 'пауза' : telemetry.state === 'live' ? 'runtime активен' : telemetry.message || 'нет данных'}` : '';
    $('runtime-pause').textContent = frame?.paused ? 'Продолжить' : 'Пауза';
    $('runtime-pause').toggleAttribute('disabled', !serverSession || serverSession.actor.role === 'viewer' || !frame || !['live', 'paused'].includes(shell.dataset.telemetry ?? ''));
    if (!serverSession) return;
    if (!controls.length) { const empty = document.createElement('div'); empty.className = 'runtime-empty'; empty.textContent = 'В проекте нет операторских уставок.'; host.append(empty); return; }
    for (const control of controls) {
      const actual = frame?.samples[`${control.id}.value`], requested = frame?.samples[`${control.id}.requested`], blocked = Boolean(frame?.samples[`${control.id}.blocked`]?.value);
      const good = actual?.quality === 'good';
      const card = document.createElement('article'); card.className = 'runtime-control-card'; card.dataset.blocked = String(blocked);
      const header = document.createElement('header'), title = document.createElement('h3'), unit = document.createElement('small');
      title.textContent = control.title; unit.textContent = `${control.id} · ${control.unit}`; header.append(title, unit);
      const values = document.createElement('div'); values.className = 'runtime-control-values';
      for (const [labelText, sample] of [['Уставка', requested], ['Фактически', actual]] as const) {
        const box = document.createElement('div'), label = document.createElement('span'), value = document.createElement('b');
        label.textContent = labelText; value.textContent = sample?.quality === 'good' && typeof sample.value === 'number' ? Number(sample.value.toFixed(3)).toString() : '—'; box.append(label, value); values.append(box);
      }
      const edit = document.createElement('div'); edit.className = 'runtime-control-edit';
      const input = document.createElement('input'); input.type = 'number'; input.min = String(control.min); input.max = String(control.max); input.step = String(control.step); input.value = typeof requested?.value === 'number' ? String(requested.value) : String(control.initial); input.setAttribute('aria-label', control.title);
      const button = document.createElement('button'); button.textContent = 'Применить';
      button.disabled = serverSession.actor.role === 'viewer' || !good || blocked || !['live', 'paused'].includes(shell.dataset.telemetry ?? '');
      input.disabled = button.disabled;
      button.onclick = () => void (async () => { try { if (!input.checkValidity()) { input.reportValidity(); return; } await runtimeCommand('operate', { target: control.id, value: Number(input.value) }); toast('Уставка принята'); } catch (e) { toast(e instanceof Error ? e.message : String(e)); } })();
      edit.append(input, button);
      const note = document.createElement('p'); note.textContent = !good ? 'Данные недостоверны: команды заблокированы.' : blocked ? control.blockedReason ?? 'Блокировка активна' : `${control.min}…${control.max} ${control.unit} · до ${control.rate}/с`;
      card.append(header, values, edit, note); host.append(card);
    }
  }
  function renderRuntimeAlarms() {
    const host = $('runtime-alarm-list'); host.replaceChildren();
    const project = serverSession?.project, frame = telemetry.frame;
    const alarms = frame?.alarms.filter(alarm => alarm.active || alarm.raisedAt !== null && !alarm.acknowledged) ?? [];
    $('runtime-alarms').hidden = !serverSession;
    $('runtime-alarm-count').hidden = !alarms.length;
    $('runtime-alarm-count').textContent = String(alarms.length);
    if (!serverSession) return;
    if (!alarms.length) { const empty = document.createElement('div'); empty.className = 'runtime-empty'; empty.textContent = 'Активных алармов нет.'; host.append(empty); return; }
    for (const alarm of alarms) {
      const rule = project?.alarms.find(item => item.id === alarm.id);
      const row = document.createElement('article'); row.className = 'runtime-alarm'; row.dataset.active = String(alarm.active);
      const text = document.createElement('div'), title = document.createElement('strong'), meta = document.createElement('small');
      title.textContent = rule?.title ?? alarm.id; meta.textContent = `${rule?.priority ?? 'alarm'} · ${alarm.active ? 'активен' : 'снят'}${alarm.acknowledged ? ' · подтверждён' : ''}`; text.append(title, meta);
      const time = document.createElement('small'); time.textContent = alarm.raisedAt ? new Date(alarm.raisedAt).toLocaleTimeString('ru-RU') : '—';
      const ack = document.createElement('button'); ack.textContent = alarm.acknowledged ? 'Подтверждён' : 'Подтвердить'; ack.disabled = alarm.acknowledged || serverSession.actor.role === 'viewer' || !['live', 'paused'].includes(shell.dataset.telemetry ?? '');
      ack.onclick = () => void (async () => { try { await runtimeCommand('ack', { target: alarm.id }); toast('Аларм подтверждён'); } catch (e) { toast(e instanceof Error ? e.message : String(e)); } })();
      row.append(text, time, ack); host.append(row);
    }
  }
  async function activateRuntimeSession(session: ServerSession) {
    await ensurePlant();
    setServerRole(session); runtimeOnly = true; runtimeRevision = session.frame.revision; workspaceSnapshot = null; pendingWorkspaceSnapshot = null;
    shell.dataset.runtimeOnly = 'true'; shell.dataset.serverProject = 'true';
    const trigger = $('project-trigger') as HTMLButtonElement; trigger.disabled = true;
    shell.querySelector<HTMLElement>('.project-trigger-name')!.textContent = session.project.title;
    window.dispatchEvent(new Event('saturn-project-change'));
    plant = plantTools!.runtimeProjection(session.project, session.frame);
    compiled = { ...compiled, scene: plant.scene };
    selected = null; filesVisible = false; codeVisible = false; propertiesVisible = false; mobilePane = 'scene';
    view.render(compiled.scene); spatial?.render(compiled.scene);
    telemetry = { state: 'live', frame: session.frame, message: '' };
    observedRuntime = plant.runtime; view.setRuntime(observedRuntime); spatial?.setRuntime(observedRuntime);
    renderTree(); renderMeta(); setSurface('scene'); syncPanels(); updatePause(); syncTelemetry();
    if (compact.matches) {
      setMode('2d');
      const groups = plant.scene.groups ?? [];
      const controlSystem = session.project.controls?.[0]?.system;
      const group = groups.find(item => item.id === controlSystem)
        ?? groups.filter(item => item.count > 0 && item.count <= 8).sort((a, b) => a.count - b.count || a.width * a.height - b.width * b.height)[0]
        ?? groups.at(-1);
      if (group) view.fitGroup(group.id); else fitScene();
    } else fitScene();
    spatial?.fit(); renderRuntimeControls(); renderRuntimeAlarms();
  }
  async function probeRuntime() {
    try {
      const session = await fetchServerSession();
      setServerRole(session);
      if (session.actor.role !== 'engineer') await activateRuntimeSession(session);
      else if (matchMedia('(display-mode: standalone)').matches || new URLSearchParams(location.search).get('project') === 'server') await loadServer();
    } catch { /* Static playground or unauthenticated landing stays local. */ }
  }
  const fileNavigator = new FileNavigator(() => ({ paths: [...documents.states.keys()], active: documents.active,
    dirty: new Set([...documents.states.keys()].filter(path => documents.dirty(path))),
    errors: new Set(errorPath ? [errorPath] : []),
    title: workspaceSnapshot ? plant?.project.title ?? 'Серверный проект' : currentDocument(workspace).title,
  }), openFile);
  async function ensurePlant() { if(!plantTools){ plantTools=await import('./plant-project'); renderEquipmentCatalog(); } }
  function openFile(path: string, pinned = false, show = true) {
    documents.capture(editor.state); editor.setState(documents.open(path, pinned));
    if (show) { codeVisible = true; mobilePane = 'source'; if (surface !== 'scene') setSurface('scene'); }
    if (innerWidth <= 1000) filesVisible = false;
    renderFiles(); syncPanels();
  }
  function renderFiles() {
    syncHistory();
    fileNavigator.render();
    const tabs = $('file-tabs'); tabs.replaceChildren();
    for (const path of documents.tabs) {
      const tab = document.createElement('div'); tab.className = 'file-tab'; tab.dataset.active = String(path === documents.active); tab.dataset.preview = String(path === documents.preview);
      const button = document.createElement('button'); button.textContent = path.split('/').at(-1)! + (documents.dirty(path) ? ' ●' : ''); button.title = path; button.dataset.tab = path;
      button.setAttribute('aria-pressed', String(path === documents.active)); button.onclick = () => openFile(path, true); tab.append(button);
      if (documents.tabs.length > 1 && !documents.dirty(path)) {
        const close = document.createElement('button'); close.textContent = '×'; close.setAttribute('aria-label', `Закрыть ${path}`);
        close.onclick = () => { documents.capture(editor.state); if (documents.close(path)) { editor.setState(documents.state); renderFiles(); syncPanels(); } }; tab.append(close);
      } tabs.append(tab);
    }
    $('file-path').textContent = documents.active;
    $('file-path').hidden = !documents.active.includes('/');
    $('file-server-state').hidden = !workspaceSnapshot && !serverLoading;
    $('file-origin').replaceChildren();
    const label = document.createElement('span'); label.textContent = workspaceSnapshot ? `Workspace · ${workspaceSnapshot.id.slice(0, 12)}` : `Локальный проект`; $('file-origin').append(label);
    if (workspaceSnapshot) { const refresh = document.createElement('button'); refresh.textContent = 'Обновить'; refresh.id = 'server-refresh'; refresh.disabled = serverLoading; refresh.onclick = () => void loadServer(); $('file-origin').append(refresh); }
    $('server-update').hidden = !pendingWorkspaceSnapshot;
    $('server-apply').toggleAttribute('disabled', documents.dirty());
    $('server-update-hint').textContent = pendingWorkspaceSnapshot && documents.dirty() ? 'Скопируйте черновик или отмените изменения перед обновлением.' : '';
    $('studio-shell').dataset.projectKind = isPlant() ? 'plant' : 'core';
    $('studio-shell').dataset.serverProject = String(!!workspaceSnapshot);
    $('studio-context').textContent = isPlant() ? 'Черновик' : 'Демо';
    $('studio-context').title = isPlant() ? 'Исходники и схема; runtime не подключён' : 'Расчётная демонстрационная модель';
    window.dispatchEvent(new Event('saturn-project-change'));
    syncServerActions(); syncTelemetry();
    $('studio-message').textContent = workspaceSnapshot ? (documents.dirty() ? 'Черновик в памяти' : 'Workspace snapshot') : isPlant() ? 'Черновик · без runtime' : $('studio-message').textContent;
  }
  async function openPlantExample() {
    try { await ensurePlant(); const files = plantTools!.nestedStarter(); plantTools!.plantProjection(files); persist();
      if (workspaceSnapshot) workspaceDraft = { snapshot: workspaceSnapshot, documents };
      const project = createProject(workspace, 'Насосная установка', files['plant.ts']);
      workspaceSnapshot = null; pendingWorkspaceSnapshot = null; updateFiles(workspace, files);
      switchDocument({ kind: 'project', id: project.id }, false); filesVisible = true; codeVisible = true; syncPanels();
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); renderMeta(); }
  }
  function activateServer(snapshot: ServerWorkspaceSnapshot) {
    persist(); runtimeOnly = false; runtimeRevision = null; delete shell.dataset.runtimeOnly; shell.dataset.serverProject = 'true'; ($('project-trigger') as HTMLButtonElement).disabled = false; workspaceSnapshot = snapshot; pendingWorkspaceSnapshot = null;
    documents = new Documents(snapshot.files, editorState, snapshot.files['src/plant.ts'] !== undefined ? 'src/plant.ts' : 'plant.ts'); editor.setState(documents.state);
    workspaceDraft = { snapshot, documents }; selected = null; clearConnection(); refresh(false); fitScene(); spatial?.fit();
    filesVisible = true; renderMeta(); syncPanels();
  }
  async function loadServer() {
    if (serverLoading) return;
    serverLoading = true;
    const serverState = $('file-server-state'); serverState.hidden = false; serverState.dataset.state = 'loading'; serverState.textContent = 'Чтение workspace…';
    $('file-tree').setAttribute('aria-busy', 'true');
    $('server-refresh')?.setAttribute('disabled', '');
    const baseDocuments = documents;
    const button = $('server-load'); button.setAttribute('disabled', ''); $('server-error').textContent = 'Загрузка…';
    try {
      await ensurePlant();
      const session = await fetchServerSession(); setServerRole(session);
      if (session.actor.role !== 'engineer') {
        await activateRuntimeSession(session);
        serverState.dataset.state = 'ready'; serverState.textContent = `Подключено · ${session.actor.role}`;
        $('server-error').textContent = ''; $<HTMLDialogElement>('server-dialog').close();
        return;
      }
      const snapshot = await fetchServerWorkspace(); plantTools!.validateFiles(snapshot.files); plantTools!.plantProjection(snapshot.files);
      if (documents !== baseDocuments) throw new Error('Проект был переключён. Повторите загрузку.');
      if (workspaceSnapshot && documents.dirty()) {
        if (snapshot.id !== workspaceSnapshot.id) pendingWorkspaceSnapshot = snapshot;
        renderFiles(); toast(snapshot.id === workspaceSnapshot.id ? 'Workspace snapshot не изменилась' : 'Workspace изменён снаружи. Черновик сохранён.');
      } else if (workspaceSnapshot?.id === snapshot.id) toast('Workspace snapshot не изменилась');
      else if (!workspaceSnapshot && workspaceDraft?.documents.dirty()) {
        persist(); workspaceSnapshot = workspaceDraft.snapshot; documents = workspaceDraft.documents; editor.setState(documents.state);
        pendingWorkspaceSnapshot = snapshot.id !== workspaceSnapshot.id ? snapshot : null; refresh(false); renderMeta(); filesVisible = true; syncPanels();
      } else activateServer(snapshot);
      serverState.dataset.state = 'ready'; serverState.textContent = `Проверено ${new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}`;
      $('server-error').textContent = ''; $<HTMLDialogElement>('server-dialog').close();
    } catch (e) { const text = e instanceof Error ? e.message : String(e); $('server-error').textContent = text; serverState.dataset.state = 'error'; serverState.textContent = text; if (!$<HTMLDialogElement>('server-dialog').open) toast(text); }
    finally { serverLoading = false; button.removeAttribute('disabled'); $('server-refresh')?.removeAttribute('disabled'); $('file-tree').setAttribute('aria-busy', 'false'); }
  }
  function patchPlantFields(id: string, patch: Record<string, Value>) {
    if (error || !plant) return;
    const target = plant.objects.get(id); if (!target) return;
    const changes = Object.entries(patch).map(([key, value]) => { const f = target.fields.find(f => f.key === key); if (!f || typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Измените выражение в исходнике'); return { from: f.from, to: f.to, insert: String(value) }; });
    if (!changes.length) return;
    openFile(target.path, true, false);
    editor.dispatch({ changes, annotations: isolateHistory.of('full'), userEvent: 'input.visual' });
  }
  let positionPreview: { id: string; x: number; y: number } | null = null, positionPreviewFrame = 0;
  function canMoveNode(id: string) {
    if (error || runtimeOnly) return false;
    const node = compiled.scene.nodes.find(item => item.id === id);
    if (!node || node.tap) return false;
    if (isPlant()) {
      const target = plant?.objects.get(id);
      return Boolean(target?.fields.some(field => field.key === 'x') && target.fields.some(field => field.key === 'y'));
    }
    return editable(compiled, id, 'x') && editable(compiled, id, 'y');
  }
  function previewPosition(id: string, x: number, y: number) {
    if (!canMoveNode(id)) return;
    positionPreview = { id, x, y };
    if (positionPreviewFrame) return;
    positionPreviewFrame = requestAnimationFrame(() => {
      positionPreviewFrame = 0;
      const preview = positionPreview; if (!preview) return;
      let scene;
      if (isPlant() && plant) {
        const simulations = plant.project.simulations.map(item => item.id === preview.id ? { ...item, at: { x: preview.x, y: preview.y } } : item);
        const devices = plant.project.devices.map(item => item.id === preview.id ? { ...item, layout: { x: preview.x, y: preview.y } } : item);
        scene = plantTools!.plantScene({ ...plant.project, simulations, devices });
      } else scene = { ...compiled.scene, nodes: compiled.scene.nodes.map(node => node.id === preview.id ? { ...node, props: { ...node.props, x: preview.x, y: preview.y } } : node) };
      view.render(scene); spatial?.render(scene); view.select(selected); spatial?.select(selected);
    });
  }
  function restorePositionPreview() {
    positionPreview = null;
    if (positionPreviewFrame) cancelAnimationFrame(positionPreviewFrame);
    positionPreviewFrame = 0;
    view.render(compiled.scene); spatial?.render(compiled.scene); view.select(selected); spatial?.select(selected);
  }
  function commitPosition(id: string, x: number, y: number) {
    positionPreview = null;
    if (positionPreviewFrame) cancelAnimationFrame(positionPreviewFrame);
    positionPreviewFrame = 0;
    if (!canMoveNode(id)) { restorePositionPreview(); return; }
    fields(id, { x, y });
  }

  $('object-source').onclick = () => {
    if (error || !selected) return;
    const object = compiled.objects.get(selected);
    const target = isPlant() ? plant?.objects.get(selected) : object ? { path: 'station.ts', ...object.span } : null; if (!target) return;
    openFile(target.path, true); editor.dispatch({ selection: { anchor: target.from, head: target.to }, scrollIntoView: true }); editor.focus();
  };
  document.querySelectorAll<HTMLButtonElement>('[data-shell-action]').forEach(button => button.onclick = () => { $(button.dataset.shellAction!).click(); button.closest('details')!.open = false; });
  function showFiles(toggle = false) { filesVisible = surface !== 'scene' || !toggle || !filesVisible; if (surface !== 'scene') setSurface('scene'); syncPanels(); saveLayout(); }
  $('equipment-search').oninput=()=>renderEquipmentCatalog();
  $('files-toggle').onclick = () => showFiles(true);
  $('files-close').onclick = () => { filesVisible = false; syncPanels(); saveLayout(); };

  // A menu owns its dismissal; Escape must not act on panels behind it.
  const projectMenu = shell.querySelector<HTMLDetailsElement>('.export-options')!;
  document.addEventListener('pointerdown', event => { if (!projectMenu.contains(event.target as Node)) projectMenu.open = false; });
  projectMenu.addEventListener('click', event => { if ((event.target as Element).closest('button')) projectMenu.open = false; });
  projectMenu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); projectMenu.open = false; projectMenu.querySelector('summary')?.focus(); }
  });

  $('studio-diagnostics').onclick = () => { if (errorPath) openFile(errorPath, true); else if (error) toast($('studio-diagnostics').textContent ?? 'Ошибка проекта'); };
  document.querySelectorAll<HTMLButtonElement>('[data-server-open]').forEach(button => button.onclick = () => { $('server-error').textContent = ''; $<HTMLDialogElement>('server-dialog').showModal(); });
  $('server-close').onclick = () => $<HTMLDialogElement>('server-dialog').close();
  $('server-load').onclick = () => void loadServer();
  $('server-apply').onclick = () => { if (pendingWorkspaceSnapshot && !documents.dirty()) activateServer(pendingWorkspaceSnapshot); };
  $('runtime-pause').onclick = () => void (async () => {
    try { await runtimeCommand(telemetry.frame?.paused ? 'resume' : 'pause'); }
    catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  })();
  $('server-save').onclick = () => void (async () => {
    if (!serverSession || serverSession.actor.role !== 'engineer' || !workspaceSnapshot || !documents.dirty() || error) return;
    try {
      documents.capture(editor.state);
      const snapshot = await serverPost<ServerWorkspaceSnapshot>(
        serverSession,
        'workspace/save',
        { files: documents.files, expected: workspaceSnapshot.id },
      );
      activateServer(snapshot);
      toast('Файлы workspace сохранены. Runtime ещё работает на предыдущем build artifact.');
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  })();
  $('server-commit-close').onclick = () => $<HTMLDialogElement>('server-commit-dialog').close();
  $('server-commit-form').onsubmit = event => { event.preventDefault(); $<HTMLDialogElement>('server-commit-dialog').close(); };
  $('server-publish').onclick = () => void (async () => {
    if (!serverSession || serverSession.actor.role !== 'engineer' || !workspaceSnapshot || documents.dirty()) return;
    try {
      const csrf = serverSession.csrf;
      const status = await serverPost<Omit<ServerSession, 'csrf'>>(
        serverSession,
        'deploy',
        { expected: serverSession.desired },
      );
      serverSession = { ...status, csrf };
      telemetry = { state: 'live', frame: status.frame, message: '' };
      runtimeRevision = status.frame.revision;
      syncTelemetry();
      renderMeta();
      toast('Workspace собран и build artifact применён');
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  })();

  function message(text: string) { $('studio-message').textContent = text; }
  function toast(text: string) { $('shell-toast').textContent = text; $('shell-toast').hidden = false; clearTimeout(toastTimer); toastTimer = window.setTimeout(() => $('shell-toast').hidden = true, 4500); }
  function persist() {
    documents.capture(editor.state);
    if (workspaceSnapshot) { message(documents.dirty() ? 'Черновик в памяти' : 'Без изменений'); renderFiles(); return true; }
    if (isPlant()) updateFiles(workspace, documents.files); else updateSource(workspace, documents.files['station.ts']);
    try { localStorage.setItem(workspaceKey, JSON.stringify(workspace)); storageAvailable = true; message('Сохранено'); return true; }
    catch { storageAvailable = false; message('Не сохранено · скачайте .ts'); return false; }
  }
  function refresh(save: boolean) {
    try {
      if (isPlant()) {
        if (!plantTools) return;
        plant = plantTools.plantProjection(documents.files);
        compiled = { ...compiled, scene: plant.scene };
      } else { plant = undefined; compiled = compile(documents.files['station.ts']); }
      error = false; errorPath = null;
      view.render(compiled.scene); spatial?.render(compiled.scene);
      view.setRuntime(plant?.runtime ?? null); spatial?.setRuntime(plant?.runtime ?? null);
      for (const [path, state] of documents.states) if (path !== documents.active) documents.states.set(path, state.update(setDiagnostics(state, [])).state);
      editor.dispatch(setDiagnostics(editor.state, []));
      if (!compiled.scene.nodes.some(n => n.id === selected) && !compiled.scene.links.some(l => l.id === selected)) selected = null;
      const warnings = plant ? [] : [...view.warnings, ...view.notes];
      $('studio-diagnostics').textContent = warnings.length ? warnings.join(' · ') : '✓ Нет ошибок';
      $('studio-diagnostics').dataset.error = 'false'; $('studio-diagnostics').title = '';
      renderTree(); select(selected); renderSignals();
      $('empty-canvas').hidden = compiled.scene.nodes.length > 0;
      $('studio-count').textContent = `${compiled.scene.nodes.length} объектов · ${compiled.scene.links.length} связей`;
    } catch (e) {
      error = true;
      const text = e instanceof Error ? e.message : String(e);
      $('studio-diagnostics').textContent = text; $('studio-diagnostics').dataset.error = 'true';
      errorPath = isPlant() ? [...documents.states.keys()].find(path => text.startsWith(path + ':')) ?? null : 'station.ts';
      $('studio-diagnostics').title = text;
      const from = e instanceof SourceError ? Math.min(editor.state.doc.length, e.from) : 0;
      const path = errorPath ?? documents.active, state = documents.states.get(path)!;
      const spec = setDiagnostics(state, [{ from: Math.min(from, state.doc.length), to: Math.min(state.doc.length, Math.max(from, e instanceof SourceError ? e.to : from)), severity: 'error', message: text }]);
      if (path === documents.active) editor.dispatch(spec); else documents.states.set(path, state.update(spec).state);
      renderInspector(); clearConnection();
    }
    $('equipment-catalog-list').querySelectorAll<HTMLButtonElement>('button').forEach(button => button.disabled = error || isPlant() || runtimeOnly);
    $('studio-connect').toggleAttribute('disabled', error || isPlant() || runtimeOnly || progress < .72);
    renderFiles(); updatePause();
    if (save) persist();
  }
  function syncServerActions() {
    const connected = Boolean(serverSession && (workspaceSnapshot || runtimeOnly));
    $('runtime-controls').hidden = !connected; $('runtime-alarms').hidden = !connected;
    const engineer = connected && serverSession?.actor.role === 'engineer' && !!workspaceSnapshot;
    $('server-save').hidden = !engineer; $('server-publish').hidden = !engineer;
    $('server-save').toggleAttribute('disabled', !engineer || !documents.dirty() || error);
    const applied = telemetry.frame?.revision ?? serverSession?.frame.revision;
    $('server-publish').toggleAttribute('disabled', !engineer || documents.dirty() || !workspaceSnapshot || workspaceSnapshot.id === applied);
  }
  function renderMeta() {
    const picker = $<HTMLSelectElement>('project-switch'); picker.replaceChildren();
    const exampleGroup = document.createElement('optgroup'); exampleGroup.label = 'Примеры';
    for (const [id, example] of Object.entries(examples)) { const option = document.createElement('option'); option.value = `example:${id}`; option.textContent = example.title; exampleGroup.append(option); }
    const template = document.createElement('option'); template.value = 'template:plant'; template.textContent = 'Многофайловая установка'; exampleGroup.append(template);
    picker.append(exampleGroup);
    if (workspace.projects.length) {
      const group = document.createElement('optgroup'); group.label = 'Проекты';
      for (const project of workspace.projects) { const option = document.createElement('option'); option.value = `project:${project.id}`; option.textContent = project.title; group.append(option); }
      picker.append(group);
    }
    if (workspaceSnapshot || runtimeOnly || workspaceDraft) { const option = document.createElement('option'); option.value = 'server:current'; option.textContent = plant?.project.title ?? serverSession?.project.title ?? 'Серверный проект'; picker.append(option); picker.value = workspaceSnapshot || runtimeOnly ? option.value : `${workspace.active.kind}:${workspace.active.id}`; }
    else picker.value = `${workspace.active.kind}:${workspace.active.id}`;
    $('project-create').hidden = runtimeOnly || !workspaceSnapshot && workspace.active.kind !== 'example';
    $('project-create').textContent = workspaceSnapshot ? 'Скопировать проект' : 'Создать проект';
    $('project-duplicate').hidden = runtimeOnly || !!workspaceSnapshot || workspace.active.kind !== 'project';
    $('studio-html').hidden = isPlant() || runtimeOnly; $('studio-share').hidden = isPlant() || runtimeOnly;
    $('equipment-toggle').hidden = isPlant() || runtimeOnly; $('studio-connect').hidden = isPlant() || runtimeOnly;
    $('studio-download').hidden = runtimeOnly || isPlant(); $('studio-download').textContent = 'Скачать исходник (.ts)';
    syncServerActions(); syncProductContext();
    documentTitle(); renderProjects();
  }
  function documentTitle() { document.title = fullscreen ? `${(workspaceSnapshot || runtimeOnly ? plant?.project.title ?? serverSession?.project.title ?? 'Установка' : currentDocument(workspace).title)} — Saturn` : 'Saturn'; }
  function select(id: string | null) {
    if (id && id !== selected) propertiesVisible = true;
    if (!id) propertiesVisible = false;
    selected = id; view.select(id); spatial?.select(id);
    $('studio-tree').querySelectorAll<HTMLButtonElement>('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.id === id)));
    if (!drag) renderInspector();
  }
  function fields(id: string, patch: Record<string, Value>) {
    if (error || runtimeOnly) return;
    if (isPlant()) { patchPlantFields(id, patch); return; }
    try { editor.dispatch({ changes: patchFields(editor.state.doc.toString(), id, patch), annotations: isolateHistory.of('full'), userEvent: 'input.visual' }); }
    catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  }
  function removeSelected() {
    if (!selected || error || isPlant() || runtimeOnly) return;
    try { editor.dispatch({ changes: removeObject(editor.state.doc.toString(), selected), annotations: isolateHistory.of('full'), userEvent: 'delete' }); }
    catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  }
  const categoryTitle:Record<string,string>={process:'Технологическое',instrumentation:'Измерительные приборы',electrical:'Электрика',mechanical:'Механика',control:'Управление',structure:'Конструкции',generic:'Другое'};
  function renderEquipmentCatalog() {
    const host=$('equipment-catalog-list'), query=$<HTMLInputElement>('equipment-search').value.trim().toLocaleLowerCase();
    host.replaceChildren();
    const entries=Object.entries(catalog).filter(([,definition])=>!query || (definition.label+' '+definition.visual?.geometry).toLocaleLowerCase().includes(query));
    const groups=new Map<string,typeof entries>();
    for(const entry of entries){const category=entry[1].visual?.category??'generic';const list=groups.get(category)??[];list.push(entry);groups.set(category,list);}
    for(const [category,items] of groups){
      const section=document.createElement('section');section.className='equipment-catalog-group';
      const heading=document.createElement('h3');heading.textContent=categoryTitle[category]??category;section.append(heading);
      for(const [kind,definition] of items.sort((a,b)=>a[1].label.localeCompare(b[1].label))){
        const button=document.createElement('button');button.type='button';button.className='equipment-catalog-item';button.dataset.catalogKind=kind;
        button.append(createGlyphSvg(document,definition.visual?.glyph??'generic.element','equipment-glyph'));
        const copy=document.createElement('span'),title=document.createElement('strong');
        title.textContent=definition.label;copy.append(title);button.append(copy);
        button.title=definition.visual?.geometry??kind;
        button.setAttribute('aria-label', `Добавить: ${definition.label}`);
        button.disabled=error || isPlant() || runtimeOnly;
        button.onclick=()=>addEquipment(kind);section.append(button);
      }
      host.append(section);
    }
    $('equipment-empty').hidden=entries.length>0;
  }
  function renderTree() {
    const tree = $('studio-tree'); tree.replaceChildren();
    for (const node of compiled.scene.nodes) {
      const button = document.createElement('button'); button.dataset.id = node.id;
      const icon=document.createElement('span');icon.className='equipment-tree-glyph';icon.append(createGlyphSvg(document,catalog[node.kind]?.visual?.glyph??'generic.element','equipment-glyph'));
      const label = document.createElement('span'); label.textContent = node.id;
      button.append(icon, label); button.title = catalog[node.kind]?.label ?? node.kind; button.onclick = () => select(node.id); tree.append(button);
    }
  }
  function renderInspector() {
    const host = $('studio-fields'); host.replaceChildren();
    const node = compiled.scene.nodes.find(n => n.id === selected), edge = compiled.scene.links.find(l => l.id === selected);
    syncPanels();
    $('studio-selected').textContent = node?.id ?? (edge ? 'Соединение' : '');
    $('studio-kind').textContent = node ? catalog[node.kind]?.label ?? node.kind : edge ? `${edge.from.node} → ${edge.to.node}` : '';
    $('object-source').toggleAttribute('disabled', error);
    $('object-source').hidden = runtimeOnly || !node || (isPlant() ? !plant?.objects.has(node.id) : !compiled.objects.has(node.id));
    if (runtimeOnly) {
      if (!node && !edge) $('studio-kind').textContent = 'Выберите объект';
      return;
    }
    if (node && isPlant()) {
      $('studio-kind').textContent = plant?.project.devices.find(d => d.id === node.id)?.type ?? node.kind;
      const source = plant?.objects.get(node.id);
      if (source) for (const field of source.fields) {
        const label = document.createElement('label'); label.textContent = field.label;
        const input = document.createElement('input'); input.type = 'number'; input.step = 'any'; input.value = String(field.value); input.disabled = error; input.setAttribute('aria-label', `${node.id}: ${field.label}`);
        input.onchange = () => { if (input.value.trim() && input.checkValidity()) { try { patchPlantFields(node.id, { [field.key]: Number(input.value) }); } catch (e) { toast(String(e)); } } };
        label.append(input); host.append(label);
      }
      if (!source) { const note = document.createElement('p'); note.textContent = 'Задано выражением в проекте'; host.append(note); }
      return;
    }
    if (!node && !edge) { $('studio-kind').textContent = 'Выберите объект'; return; }
    if (node) for (const [key, field] of Object.entries(catalog[node.kind].fields)) {
      if (['nominalFlow', 'degradationRate', 'startDelay', 'maintenanceSeconds'].includes(key)) continue;
      const label = document.createElement('label'); label.textContent = field.label + (field.unit ? ` · ${field.unit}` : '');
      const input = field.choices ? document.createElement('select') : document.createElement('input');
      if (input instanceof HTMLSelectElement) for (const choice of field.choices!) { const option = document.createElement('option'); option.value = choice; option.textContent = choice; input.append(option); }
      else { input.type = 'number'; input.min = String(field.min ?? -9999); input.max = String(field.max ?? 9999); input.step = String(field.step ?? 1); }
      input.value = String(node.props[key]); input.setAttribute('aria-label', `${node.id}: ${field.label}`);
      input.disabled = error || !editable(compiled, node.id, key);
      if (!editable(compiled, node.id, key)) input.title = 'Задано выражением. Измените исходник.';
      input.onchange = () => {
        if (!input.value.trim() || !input.checkValidity()) { input.reportValidity(); input.value = String(node.props[key]); return; }
        fields(node.id, { [key]: typeof field.default === 'number' ? Number(input.value) : input.value });
      };
      label.append(input); host.append(label);
    }
    const remove = document.createElement('button'); remove.className = 'studio-delete'; remove.textContent = edge ? 'Удалить связь' : 'Удалить объект'; remove.disabled = error; remove.onclick = removeSelected; host.append(remove);
  }
  function renderSignals() {
    const rows = $('signal-rows'); rows.replaceChildren();
    if (plant) {
      for (const device of plant.project.devices) for (const name of Object.keys(device.signals)) {
        const signal = observedRuntime?.equipment[device.id]?.signals[name];
        const retained = signal?.value !== null && signal?.value !== undefined && (signal.quality === 'good' || signal.quality === 'stale');
        const value = retained ? `${typeof signal.value === 'number' ? Number(signal.value.toFixed(3)) : signal.value} ${signal.unit}` : '—';
        const source = shell.dataset.telemetry === 'stale' ? 'STALE · последнее подтверждённое значение' : ['live', 'paused'].includes(shell.dataset.telemetry ?? '') ? `Симуляция · ${signal?.quality ?? 'offline'}` : $('studio-context').textContent ?? 'Нет данных';
        const row = document.createElement('tr'); row.dataset.signal = `${device.id}.${name}`; row.dataset.quality = signal?.quality ?? 'offline';
        for (const cell of [device.id, name, value, source]) { const td = document.createElement('td'); td.textContent = cell; row.append(td); } rows.append(row);
      }
      return;
    }
    for (const node of compiled.scene.nodes) {
      const data = Object.entries(catalog[node.kind].fields).filter(([key, field]) => typeof field.default === 'number' && !['x', 'y', 'at', 'offset', 'nominalFlow', 'degradationRate', 'startDelay', 'maintenanceSeconds'].includes(key)).map(([key, field]) => [field.label, `${node.props[key]} ${field.unit ?? ''}`, 'Задано в проекте']);
      if (view.flows.has(node.id)) data.push(['Расход', view.flows.get(node.id) === null ? 'Неизвестно' : `${view.flows.get(node.id)!.toFixed(1)} м³/ч`, 'Расчёт учебной модели']);
      for (const cells of data) { const row = document.createElement('tr'); for (const value of [node.id, ...cells]) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); } rows.append(row); }
    }
  }
  function renderProjects() {
    const list = $('project-list'); list.replaceChildren();
    if (!workspace.projects.length) {
      const empty = document.createElement('div'); empty.className = 'project-empty';
      const heading = document.createElement('strong'); heading.textContent = 'Нет проектов';
      const text = document.createElement('p'); text.textContent = 'Создайте проект из примера.';
      empty.append(heading, text); list.append(empty);
    }
    for (const project of [...workspace.projects].reverse()) {
      const button = document.createElement('button'); button.className = 'project-card'; button.dataset.projectId = project.id;
      const symbol = document.createElement('span'); symbol.className = 'project-symbol'; symbol.innerHTML = '<svg><use href="#i-folder"/></svg>';
      const content = document.createElement('div'), name = document.createElement('strong'), meta = document.createElement('small');
      name.textContent = project.title; meta.textContent = new Date(project.updatedAt).toLocaleDateString('ru-RU');
      content.append(name, meta); const arrow = document.createElement('span'); arrow.textContent = '↗';
      button.append(symbol, content, arrow); button.onclick = async () => { if (project.files?.['plant.ts']) await ensurePlant(); switchDocument({ kind: 'project', id: project.id }); }; list.append(button);
    }
  }
  function switchDocument(active: WorkspaceState['active'], save = true) {
    if (save) { persist(); if (workspaceSnapshot) workspaceDraft = { snapshot: workspaceSnapshot, documents }; } runtimeOnly = false; runtimeRevision = null; delete shell.dataset.runtimeOnly; shell.dataset.serverProject = 'false'; ($('project-trigger') as HTMLButtonElement).disabled = false; workspaceSnapshot = null; pendingWorkspaceSnapshot = null; setServerRole(null); workspace.active = active; selected = null; clearConnection();
    const next = currentDocument(workspace);
    documents = new Documents(next.files ?? { 'station.ts': next.source }, editorState, next.files?.['plant.ts'] !== undefined ? 'plant.ts' : 'station.ts');
    editor.setState(documents.state); refresh(false); fitScene();
    spatial?.fit(); renderMeta(); setSurface('scene'); persist();
    setMode(explicit);
    revealShell();
  }
  function saveLayout() { try { localStorage.setItem('saturn.shell.layout.v1', JSON.stringify({ filesVisible, codeVisible, sourceWidth: shell.style.getPropertyValue('--source-width'), navigatorWidth: shell.style.getPropertyValue('--navigator-width') })); } catch {} }
  function syncPanels() {
    const mobile = compact.matches;
    if (!selected && mobilePane === 'properties') mobilePane = 'scene';
    if (!selected) propertiesVisible = false;
    $('inspector-toggle').toggleAttribute('disabled', !selected);
    if (runtimeOnly || serverSession && serverSession.actor.role !== 'engineer') { filesVisible = false; codeVisible = false; propertiesVisible = false; mobilePane = 'scene'; }
    $('file-browser').hidden = !filesVisible; $('files-toggle').setAttribute('aria-expanded', String(filesVisible));
    $('studio-editor-pane').hidden = mobile ? mobilePane !== 'source' : !codeVisible;
    $('source-splitter').hidden = mobile || !codeVisible;
    inspector.hidden = mobile ? mobilePane !== 'properties' : !propertiesVisible;
    shell.dataset.mobilePane = mobilePane;
    $('studio-code').setAttribute('aria-pressed', String(surface === 'scene' && (mobile ? mobilePane === 'source' : codeVisible)));
    $('inspector-toggle').setAttribute('aria-pressed', String(surface === 'scene' && (mobile ? mobilePane === 'properties' : propertiesVisible)));
    $('mobile-scene').setAttribute('aria-pressed', String(surface === 'scene' && mobilePane === 'scene'));
    shell.querySelectorAll<HTMLButtonElement>('[data-shell-view]').forEach(button => button.setAttribute('aria-pressed', String(surface === button.dataset.shellView)));
    requestAnimationFrame(() => { editor.requestMeasure(); capPlantScale(); });
  }
  function toggleCode() { if (surface !== 'scene') { codeVisible = true; mobilePane = 'source'; setSurface('scene'); } else if (compact.matches) mobilePane = mobilePane === 'source' ? 'scene' : 'source'; else codeVisible = !codeVisible; syncPanels(); saveLayout(); }
  function toggleEquipment(open = $('equipment-browser').hidden) {
    const browser = $('equipment-browser');
    const restoreFocus = browser.contains(document.activeElement);
    browser.hidden = !open;
    $('equipment-toggle').setAttribute('aria-expanded', String(open));
    if (open) {
      filesVisible = false; syncPanels(); renderEquipmentCatalog();
      $<HTMLInputElement>('equipment-search').focus({ preventScroll: true });
    } else if (restoreFocus) $('equipment-toggle').focus({ preventScroll: true });
    requestAnimationFrame(() => editor.requestMeasure());
  }
  function setSurface(next: Surface) {
    if (next === 'source') { codeVisible = true; mobilePane = 'source'; next = 'scene'; }
    if (next === 'equipment') { toggleEquipment(true); next = 'scene'; }
    surface = next; shell.dataset.surface = next;
    $('scene-panel').hidden = next !== 'scene';
    $('signals-panel').hidden = next !== 'signals'; $('controls-panel').hidden = next !== 'controls'; $('alarms-panel').hidden = next !== 'alarms'; $('projects-panel').hidden = next !== 'projects';
    document.querySelectorAll<HTMLDetailsElement>('.export-options').forEach(menu => menu.open = false);
    if (next === 'signals') renderSignals();
    if (next === 'controls') renderRuntimeControls();
    if (next === 'alarms') renderRuntimeAlarms();
    syncPanels(); renderMeta(); animateState();
  }
  function revealShell() { if (!fullscreen) stage.scrollIntoView({ block: 'start', behavior: reduced.matches ? 'instant' : 'smooth' }); }
  function setFullscreen(enabled: boolean) {
    if (fullscreen === enabled) return;
    if (enabled) scrollBeforeFullscreen = scrollY;
    fullscreen = enabled; document.body.classList.toggle('shell-fullscreen', enabled);
    for (const node of document.querySelectorAll<HTMLElement>('.site-header,.hero')) node.inert = enabled;
    const control = $('shell-fullscreen'); control.setAttribute('aria-label', enabled ? 'Вернуться на лендинг' : 'Развернуть на весь экран'); control.setAttribute('title', control.getAttribute('aria-label')!);
    control.querySelector('use')!.setAttribute('href', enabled ? '#i-collapse' : '#i-expand');
    if (enabled) { if (!compact.matches && !runtimeOnly) codeVisible = true; syncPanels(); } else window.scrollTo({ top: scrollBeforeFullscreen, behavior: 'instant' });
    visible = true; animateState(); documentTitle();
    requestAnimationFrame(() => { editor.requestMeasure(); spatial?.fit(); });
  }
  function openProjectDialog(empty = false) {
    $('project-error').textContent = '';
    $('project-dialog-title').textContent = empty ? 'Новый проект' : workspaceSnapshot ? 'Скопировать проект' : workspace.active.kind === 'example' ? 'Создать проект' : 'Дублировать проект';
    $<HTMLSelectElement>('project-base').querySelector<HTMLOptionElement>('[value="current"]')!.textContent = workspaceSnapshot ? 'Серверный проект с изменениями' : 'Текущий проект с изменениями';
    $<HTMLInputElement>('project-name').value = empty ? 'Новая установка' : `${(workspaceSnapshot ? plant?.project.title ?? 'Проект' : currentDocument(workspace).title)} — мой проект`;
    $<HTMLSelectElement>('project-base').value = empty ? 'empty' : 'current';
    $<HTMLDialogElement>('project-dialog').showModal(); $<HTMLInputElement>('project-name').select();
  }
  $('project-form').onsubmit = event => {
    event.preventDefault();
    const source = $<HTMLSelectElement>('project-base').value === 'empty' ? emptySource : editor.state.doc.toString();
    try {
      const fromFiles = $<HTMLSelectElement>('project-base').value !== 'empty' && isPlant() ? documents.files : null;
      if (fromFiles) plantTools!.plantProjection(fromFiles); else compile(source); persist();
      const copiedServer = workspaceSnapshot, previousServerDocuments = documents;
      createProject(workspace, $<HTMLInputElement>('project-name').value, fromFiles?.['plant.ts'] ?? source);
      workspaceSnapshot = null; pendingWorkspaceSnapshot = null;
      if (fromFiles) {
        updateFiles(workspace, fromFiles);
        const previous = documents;
        documents = new Documents(fromFiles, editorState, previous.active);
        for (const [path, state] of previous.states) documents.states.set(path, state);
        documents.tabs = [...previous.tabs]; documents.preview = previous.preview;
        editor.setState(documents.state);
      }
      if (!fromFiles && (source !== editor.state.doc.toString() || isPlant())) { selected = null; documents = new Documents({ 'station.ts': source }, editorState, 'station.ts'); editor.setState(documents.state); refresh(false); fitScene(); }
      const saved = persist();
      if (copiedServer) workspaceDraft = { snapshot: copiedServer, documents: saved && fromFiles ? new Documents(copiedServer.files, editorState, 'plant.ts') : previousServerDocuments };
      renderFiles(); renderMeta(); setSurface('scene'); setFullscreen(true);
      $<HTMLDialogElement>('project-dialog').close(); toast(saved ? 'Проект создан' : 'Проект открыт в памяти. Хранилище недоступно — скачайте .ts.');
    } catch (e) { $('project-error').textContent = e instanceof Error ? e.message : String(e); }
  };
  $('project-dialog-close').onclick = () => $<HTMLDialogElement>('project-dialog').close();
  document.querySelectorAll<HTMLButtonElement>('[data-create-project]').forEach(button => button.onclick = () => openProjectDialog());
  document.querySelectorAll<HTMLButtonElement>('[data-new-project]').forEach(button => button.onclick = () => openProjectDialog(true));
  $('project-duplicate').onclick = () => openProjectDialog();
  $('project-switch').onchange = async () => { const [kind, id] = $<HTMLSelectElement>('project-switch').value.split(':'); if (kind === 'server') { await loadServer(); return; } if (kind === 'template') { await openPlantExample(); return; } if (kind === 'project' && workspace.projects.find(p => p.id === id)?.files?.['plant.ts']) await ensurePlant(); switchDocument(kind === 'example' ? { kind, id: id as ExampleId } : { kind: 'project', id }); };
  document.querySelectorAll<HTMLButtonElement>('[data-shell-view]').forEach(button => button.onclick = () => setSurface(button.dataset.shellView as Surface));
  $('studio-code').onclick = toggleCode;
  $('equipment-toggle').onclick = () => toggleEquipment();
  $('equipment-close').onclick = () => toggleEquipment(false);
  $('empty-add').onclick = () => toggleEquipment(true);
  $('mobile-scene').onclick = () => { mobilePane = 'scene'; setSurface('scene'); };
  $('inspector-toggle').onclick = () => { if (surface !== 'scene') { propertiesVisible = true; mobilePane = 'properties'; setSurface('scene'); } else if (compact.matches) mobilePane = mobilePane === 'properties' ? 'scene' : 'properties'; else propertiesVisible = !propertiesVisible; renderInspector(); syncPanels(); };
  $('inspector-close').onclick = () => { propertiesVisible = false; mobilePane = 'scene'; syncPanels(); };
  $('shell-fullscreen').onclick = () => setFullscreen(!fullscreen);
  view.onSelect = select;
  canvas.addEventListener('click', event => {
    const target = (event.target as Element); if (target.closest('[data-port]')) return;
    const object = target.closest('[data-node], [data-edge]'); if (object) select(object.getAttribute('data-node') ?? object.getAttribute('data-edge'));
  });
  let drag: { id: string; x: number; y: number; startX: number; startY: number; dx: number; dy: number; element: SVGGElement; transform: string } | null = null;
  let pan: { x: number; y: number; cameraX: number; cameraY: number } | null = null;
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const port = (event.target as Element).closest<SVGElement>('[data-port]');
    if (port && connecting) { choosePort(port.dataset.owner!, port.dataset.port!); event.preventDefault(); return; }
    if (connecting) return;
    const element = (event.target as Element).closest<SVGGElement>('[data-node]');
    const node = compiled.scene.nodes.find(n => n.id === element?.dataset.node);
    const point = view.point(event.clientX, event.clientY);
    if (!element || !node) { if (event.pointerType === 'mouse' || fullscreen) { pan = { x: event.clientX, y: event.clientY, cameraX: view.camera.x, cameraY: view.camera.y }; canvas.setPointerCapture(event.pointerId); } return; }
    if (isPlant() || runtimeOnly) { select(node.id); return; }
    if (error || node.tap || !editable(compiled, node.id, 'x') || !editable(compiled, node.id, 'y')) return;
    drag = { id: node.id, x: Number(node.props.x), y: Number(node.props.y), startX: point.x, startY: point.y, dx: 0, dy: 0, element, transform: element.getAttribute('transform') ?? '' };
    canvas.setPointerCapture(event.pointerId); select(node.id);
  });
  canvas.addEventListener('pointermove', event => {
    if (pan) { const a = view.point(pan.x, pan.y), b = view.point(event.clientX, event.clientY); view.setCamera({ ...view.camera, x: pan.cameraX + a.x - b.x, y: pan.cameraY + a.y - b.y }); return; }
    if (!drag) return;
    const point = view.point(event.clientX, event.clientY); drag.dx = point.x - drag.startX; drag.dy = point.y - drag.startY;
    drag.element.setAttribute('transform', `translate(${drag.dx} ${drag.dy}) ${drag.transform}`);
    view.previewMove(drag.id, drag.x + drag.dx, drag.y + drag.dy);
  });
  canvas.addEventListener('pointerup', () => { pan = null; if (!drag) return; const d = drag; drag = null; d.element.setAttribute('transform', d.transform); if (Math.hypot(d.dx, d.dy) > 2) fields(d.id, { x: Math.round(d.x + d.dx), y: Math.round(d.y + d.dy) }); else { view.previewMove(d.id, d.x, d.y); renderInspector(); } });
  canvas.addEventListener('pointercancel', () => { pan = null; if (drag) { drag.element.setAttribute('transform', drag.transform); view.previewMove(drag.id, drag.x, drag.y); } drag = null; });
  canvas.addEventListener('wheel', event => { if (!fullscreen && !event.ctrlKey && !event.metaKey) return; event.preventDefault(); const before = view.point(event.clientX, event.clientY); view.zoom(Math.exp(event.deltaY * .0015)); const after = view.point(event.clientX, event.clientY); view.setCamera({ ...view.camera, x: view.camera.x + before.x - after.x, y: view.camera.y + before.y - after.y }); }, { passive: false });
  function clearConnection() { connecting = null; shell.classList.remove('connecting'); $('studio-connect').setAttribute('aria-pressed', 'false'); $('studio-mode-note').textContent = ''; $('studio-mode-note').hidden = true; }
  function choosePort(node: string, port: string) {
    if (!connecting || error) return;
    const object = compiled.scene.nodes.find(n => n.id === node);
    if (!object) return;
    if (connecting === 'choose') {
      if (catalog[object.kind].ports[port]?.role !== 'out') { toast('Сначала выберите выходной порт'); return; }
      connecting = { node, port }; $('studio-mode-note').textContent = 'Выберите вход'; $('studio-mode-note').hidden = false; return;
    }
    try { const source = appendConnection(editor.state.doc.toString(), connecting, { node, port }); editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: source }, annotations: isolateHistory.of('full'), userEvent: 'input' }); clearConnection(); }
    catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  }
  $('studio-connect').onclick = () => { if (connecting) clearConnection(); else { connecting = 'choose'; shell.classList.add('connecting'); $('studio-connect').setAttribute('aria-pressed', 'true'); $('studio-mode-note').textContent = 'Выберите выход'; $('studio-mode-note').hidden = false; } };
  canvas.addEventListener('keydown', event => { const target = event.target as SVGElement; if ((event.key === 'Enter' || event.key === ' ') && target.dataset.port && connecting) { event.preventDefault(); choosePort(target.dataset.owner!, target.dataset.port); } });
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || document.querySelector('dialog[open], :popover-open')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') { event.preventDefault(); showFiles(true); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') { event.preventDefault(); showFiles(); $('file-search').focus(); return; }
    if (event.key === 'Escape' && projectMenu.open) { event.preventDefault(); projectMenu.open = false; projectMenu.querySelector('summary')?.focus(); return; }
    if (event.key === 'Escape') { if (connecting) clearConnection(); else if (!$('equipment-browser').hidden) { event.preventDefault(); toggleEquipment(false); } else if (filesVisible) { filesVisible = false; syncPanels(); } else if (selected) select(null); else setFullscreen(false); return; }
    if ((event.target as Element).closest('input,select,textarea,.cm-editor')) return;
    if (!fullscreen && !shell.contains(document.activeElement)) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo(editor) : undo(editor); }
    else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); download(); }
    else if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); $('studio-fit').click(); }
    else if (selected && /^Arrow/.test(event.key) && progress >= .72) {
      const node = compiled.scene.nodes.find(n => n.id === selected);
      if (node && !node.tap) { event.preventDefault(); const step = event.shiftKey ? 1 : 10; fields(node.id, { x: Number(node.props.x) + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), y: Number(node.props.y) + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) }); }
    }
    else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelected(); }
  });
  $('studio-undo').onclick = () => undo(editor); $('studio-redo').onclick = () => redo(editor);
  $('studio-fit').onclick = () => { fitScene(); spatial?.fit(); };
  $('studio-plus').onclick = () => { if (progress < .72) spatial?.zoom(.8); else view.zoom(.8); };
  $('studio-minus').onclick = () => { if (progress < .72) spatial?.zoom(1.25); else view.zoom(1.25); };
  function addEquipment(kind: string) {
    if (error || isPlant() || runtimeOnly) return;
    try { const source = kind === 'pressure' || kind === 'temperature' ? appendTap(editor.state.doc.toString(), selected ?? '', kind) : appendEquipment(editor.state.doc.toString(), kind, 450, 480); editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: source }, annotations: isolateHistory.of('full'), userEvent: 'input' }); toggleEquipment(false); fitScene(); spatial?.fit(); select(compiled.scene.nodes.at(-1)?.id ?? null); }
    catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  };
  function animateState() { const active = (visible || fullscreen) && !document.hidden && !['signals', 'controls', 'alarms', 'projects'].includes(surface); const stopped = isPlant() || runtimeOnly ? shell.dataset.telemetry !== 'live' : paused; view.paused = stopped || !active; if (spatial) spatial.paused = stopped || !active || progress >= 1; }
  function updatePause() { $('studio-play').hidden = isPlant() || runtimeOnly; $('studio-play').innerHTML = `<svg aria-hidden="true"><use href="#i-${paused ? 'play' : 'pause'}"/></svg>`; $('studio-play').title = paused ? 'Запустить демонстрацию' : 'Приостановить демонстрацию'; $('studio-play').setAttribute('aria-label', $('studio-play').title); $('studio-play').setAttribute('aria-pressed', String(!paused)); }
  $('studio-play').onclick = () => { paused = !paused; animateState(); updatePause(); };
  document.addEventListener('visibilitychange', animateState);
  reduced.addEventListener('change', () => { if (reduced.matches) paused = true; updatePause(); animateState(); });
  function download() { if (isPlant()) downloadFile('saturn-project.json', JSON.stringify(documents.files, null, 2)); else downloadFile('saturn-station.ts', documents.files['station.ts']); }
  $('studio-html').onclick = async () => { try { const source = editor.state.doc.toString(); await exportHTML(source, compile(source).scene); } catch (e) { toast(e instanceof Error ? e.message : String(e)); } };
  $('studio-share').onclick = async () => { try { await navigator.clipboard.writeText(shareURL(editor.state.doc.toString())); toast('Ссылка с исходником скопирована'); } catch (e) { toast(e instanceof Error ? e.message : String(e)); } };
  let resizing = false;
  function resizeSource(clientX: number) { const area = $('studio-editor-pane').getBoundingClientRect(); const width = Math.max(230, Math.min($('studio-editor-pane').parentElement!.clientWidth * .65, clientX - area.left)); shell.style.setProperty('--source-width', `${width}px`); editor.requestMeasure(); }
  $('source-splitter').onpointerdown = event => { resizing = true; $('source-splitter').setPointerCapture(event.pointerId); event.preventDefault(); };
  $('source-splitter').onpointermove = event => { if (resizing) resizeSource(event.clientX); };
  $('source-splitter').onpointerup = () => { resizing = false; saveLayout(); };
  $('source-splitter').onpointercancel = () => resizing = false;
  const fileResizer = $('files-resizer');
  const resizeNavigator = (x: number) => {
    const left = $('file-browser').getBoundingClientRect().left;
    const width = Math.max(200, Math.min(400, shell.clientWidth - 35, x - left));
    shell.style.setProperty('--navigator-width', `${width}px`); fileResizer.setAttribute('aria-valuenow', String(Math.round(width)));
    editor.requestMeasure();
  };
  fileResizer.onpointerdown = event => { fileResizer.setPointerCapture(event.pointerId); event.preventDefault(); };
  fileResizer.onpointermove = event => { if (fileResizer.hasPointerCapture(event.pointerId)) resizeNavigator(event.clientX); };
  fileResizer.onpointerup = event => { fileResizer.releasePointerCapture(event.pointerId); saveLayout(); };
  fileResizer.onkeydown = event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); resizeNavigator(fileResizer.getBoundingClientRect().right + (event.key === 'ArrowLeft' ? -16 : 16)); saveLayout(); } };

  $('source-splitter').onkeydown = event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); resizeSource($('source-splitter').getBoundingClientRect().left + (event.key === 'ArrowLeft' ? -20 : 20)); } };
  $('studio-download').onclick = download; $('studio-import').onclick = () => $<HTMLInputElement>('studio-file').click();
  $('studio-file').onchange = async () => {
    const input = $<HTMLInputElement>('studio-file'), file = input.files?.[0]; if (!file) return;
    try {
      if (/\.json$/i.test(file.name)) { await ensurePlant(); const files = JSON.parse(await file.text()); plantTools!.validateFiles(files); plantTools!.plantProjection(files); persist(); const oldServer = workspaceSnapshot; createProject(workspace, file.name.replace(/\.json$/i, '').slice(0,80), files['plant.ts']); if (oldServer) workspaceDraft = { snapshot: oldServer, documents }; workspaceSnapshot = null; pendingWorkspaceSnapshot = null; updateFiles(workspace, files); switchDocument(workspace.active, false); filesVisible = true; syncPanels(); input.value = ''; return; }
      if (file.size > 120000) throw new Error('Размер файла должен быть меньше 120 КБ');
      const source = await file.text(); compile(source); persist(); if (workspaceSnapshot) workspaceDraft = { snapshot: workspaceSnapshot, documents }; createProject(workspace, file.name.replace(/\.ts$/i, '').slice(0, 80) || 'Импорт', source);
      workspaceSnapshot = null; pendingWorkspaceSnapshot = null; documents = new Documents({ 'station.ts': source }, editorState, 'station.ts'); editor.setState(documents.state); selected = null; refresh(false); fitScene(); persist(); renderMeta(); setSurface('scene'); setMode('2d'); toast('Исходник импортирован в новый проект');
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
    input.value = '';
  };
  function setMode(mode: '2d' | '3d') { explicit = mode; present(mode === '2d' ? 1 : 0); }
  $('studio-2d').onclick = () => setMode('2d'); $('studio-3d').onclick = () => setMode('3d');
  function present(value: number) {
    progress = spatial ? value : 1;
    const flat = progress > .72;
    shell.style.setProperty('--studio-progress', String(progress)); shell.dataset.mode = flat ? '2d' : '3d';
    $('studio-2d').setAttribute('aria-pressed', String(flat)); $('studio-3d').setAttribute('aria-pressed', String(!flat));
    $('studio-connect').toggleAttribute('disabled', error || isPlant() || runtimeOnly || !flat); if (!flat) clearConnection();
    spatialHost.inert = flat; $('studio-flat').inert = !flat; spatialHost.style.visibility = progress >= 1 ? 'hidden' : 'visible';
    spatial?.fit(); animateState();
  }
  function syncCanvasTheme() {
    const style = getComputedStyle(shell);
    spatial?.setAppearance(style.getPropertyValue('--canvas-bg').trim(), style.getPropertyValue('--canvas-grid').trim());
  }
  window.addEventListener('saturn-theme-change', syncCanvasTheme);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncCanvasTheme);
  window.addEventListener('resize', () => { spatial?.fit(); syncPanels(); });
  const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; animateState(); }, { rootMargin: '80px' }); observer.observe(stage);
  window.addEventListener('pagehide', persist);
  window.addEventListener('saturn-before-update', event => {
    persist();
    if (!storageAvailable || workspaceSnapshot && documents.dirty() || workspaceDraft?.documents.dirty()) event.preventDefault();
  });
  window.addEventListener('beforeunload', event => { if (workspaceSnapshot && documents.dirty() || workspaceDraft?.documents.dirty()) { event.preventDefault(); event.returnValue = ''; } });
  try { const layout = JSON.parse(localStorage.getItem('saturn.shell.layout.v1') ?? '{}'); filesVisible = layout.filesVisible === true; if (typeof layout.codeVisible === 'boolean') codeVisible = layout.codeVisible; if (/^\d+(\.\d+)?px$/.test(layout.navigatorWidth ?? '')) shell.style.setProperty('--navigator-width', layout.navigatorWidth); if (/^\d+(\.\d+)?px$/.test(layout.sourceWidth ?? '')) shell.style.setProperty('--source-width', layout.sourceWidth); } catch {}
  if (isPlant()) await ensurePlant();
  renderEquipmentCatalog();
  view.render(compiled.scene); refresh(false); fitScene(); updatePause(); renderMeta();
  message(storageAvailable ? '' : 'Хранилище недоступно');
  try {
    const { SceneView3D } = await import('../src/view3d'); spatial = new SceneView3D(spatialHost, { landing: true }); syncCanvasTheme(); spatial.onSelect = select;
    spatial.canMove = canMoveNode;
    spatial.onMove = (id, x, y, commit) => commit ? commitPosition(id, x, y) : previewPosition(id, x, y);
    spatial.render(compiled.scene); spatial.setRuntime(observedRuntime ?? plant?.runtime ?? null); spatial.select(selected); setMode(explicit);
  } catch { $('studio-3d').setAttribute('disabled', ''); present(1); toast('WebGL недоступен. Работайте с 2D-схемой.'); }
  const requestedServer = !shared && new URLSearchParams(location.search).get('project') === 'server';
  await probeRuntime();
  if (runtimeOnly || matchMedia('(display-mode: standalone)').matches || location.hash === '#studio' || location.hash === '#workspace' || shared) setFullscreen(true);
  if (shared) persist();
  // probeRuntime owns authenticated activation. Only unauthenticated server links
  // need the connection dialog; operator/viewer deliberately have no source revision.
  if (requestedServer && !workspaceSnapshot && !runtimeOnly) $<HTMLDialogElement>('server-dialog').showModal();
}
