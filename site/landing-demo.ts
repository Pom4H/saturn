/** Disposable landing experience. Uses the production compiler, glyphs and routes;
 * never mounts project, server, command or 3D tools and never writes workspace storage. */
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, undo, redo, undoDepth, indentWithTab, isolateHistory } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { bracketMatching, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { autocompletion, closeBrackets } from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';
import { setDiagnostics } from '@codemirror/lint';
import { compile, patchFields, editable, SourceError } from '../src/source';
import { dslCompletions } from '../src/completion';
import { SceneView } from '../src/view';
import '../src/visual-components';
import { examples } from './shell-projects';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export function mountLandingDemo(): void {
  const shell = $('studio-shell');
  shell.dataset.demo = 'true'; shell.dataset.mode = '2d'; shell.dataset.mobilePane = 'scene';
  shell.style.setProperty('--studio-progress', '1');
  $('studio-flat').inert = false; $('studio-spatial').inert = true;
  const header = document.createElement('header'); header.className = 'demo-header';
  header.innerHTML = `<div class="demo-heading"><strong>Насосная станция</strong><span>Интерактивный пример</span></div>
    <nav class="demo-tabs" aria-label="Представление примера"><button data-demo-pane="scene" aria-pressed="true">Схема</button><button data-demo-pane="source" aria-pressed="false">Код</button></nav>
    <a class="demo-open" href="?mode=ide#workspace">Открыть IDE ↗</a>`;
  shell.prepend(header);
  const hint = document.createElement('p'); hint.className = 'demo-hint';
  hint.textContent = 'Перетащите насос — координаты в коде изменятся.'; shell.append(hint);
  const reset = document.createElement('button'); reset.id = 'demo-reset'; reset.textContent = 'Сбросить'; reset.title = 'Вернуть исходный пример';
  $('studio-undo').parentElement!.append(reset, $('studio-play'), $('studio-fit'));
  const canvas = document.getElementById('studio-svg') as unknown as SVGSVGElement;
  const view = new SceneView(canvas), compact = matchMedia('(max-width:760px)'), reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let compiled = compile(examples.pump.source), error = false, paused = reduced.matches, visible = true;
  let selected: string | null = null, pane = 'scene';
  const theme = EditorView.theme({
    '&': { height: '100%', background: 'var(--bg)', color: 'var(--text)', fontSize: '13px' },
    '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--mono)' },
    '.cm-content': { padding: '16px 0', caretColor: 'var(--text)' },
    '.cm-gutters': { background: 'var(--bg)', color: 'var(--muted)', border: 'none' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { background: 'var(--shell-selection)' },
    '.cm-activeLine': { background: 'var(--shell-panel)' },
  });
  function state() {
    return EditorState.create({ doc: examples.pump.source, extensions: [
      lineNumbers(), drawSelection(), history(), highlightActiveLine(), EditorView.lineWrapping,
      javascript({ typescript: true }), bracketMatching(), closeBrackets(), theme,
      syntaxHighlighting(HighlightStyle.define([
        { tag: tags.keyword, color: 'var(--code-keyword)' }, { tag: tags.string, color: 'var(--code-string)' },
        { tag: tags.number, color: 'var(--code-number)' }, { tag: tags.comment, color: 'var(--code-comment)' },
        { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: 'var(--code-function)' },
        { tag: tags.propertyName, color: 'var(--code-property)' },
      ])),
      autocompletion({ override: [context => {
        const word = context.matchBefore(/[\w-]*/);
        return !word || word.from === word.to && !context.explicit ? null
          : { from: word.from, options: dslCompletions(context.state.doc.toString(), context.pos, compiled.scene) };
      }] }),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.contentAttributes.of({ 'aria-label': 'Исходник установки TypeScript', spellcheck: 'false' }),
      EditorView.updateListener.of(update => {
        if (update.docChanged) render();
        $('studio-undo').toggleAttribute('disabled', undoDepth(update.state) === 0);
      }),
    ] });
  }
  const editor = new EditorView({ parent: $('studio-editor'), state: state() });
  function render() {
    const diagnostics = $('studio-diagnostics');
    try {
      compiled = compile(editor.state.doc.toString()); error = false;
      view.render(compiled.scene); view.select(selected);
      diagnostics.dataset.error = 'false'; diagnostics.textContent = '';
      editor.dispatch(setDiagnostics(editor.state, []));
    } catch (cause) {
      error = true;
      const message = cause instanceof Error ? cause.message : String(cause);
      diagnostics.dataset.error = 'true'; diagnostics.textContent = message;
      const length = editor.state.doc.length;
      const from = Math.max(0, Math.min(length, cause instanceof SourceError ? cause.from : 0));
      const to = Math.max(from, Math.min(length, cause instanceof SourceError ? cause.to : from));
      editor.dispatch(setDiagnostics(editor.state, [{ from, to, severity: 'error', message }]));
    }
  }
  function select(id: string | null) {
    selected = id; view.select(id);
    const object = id ? compiled.objects.get(id) : null;
    if (object && !error) editor.dispatch({ selection: { anchor: object.span.from }, scrollIntoView: true });
  }
  view.onSelect = select;
  function move(id: string, x: number, y: number) {
    if (error) return;
    editor.dispatch({ changes: patchFields(editor.state.doc.toString(), id, { x, y }),
      annotations: isolateHistory.of('full'), userEvent: 'input.visual' });
  }
  let drag: { id: string; pointer: number; x: number; y: number; startX: number; startY: number; dx: number; dy: number; element: SVGGElement; transform: string } | null = null;
  function cancelDrag() {
    if (!drag) return;
    drag.element.setAttribute('transform', drag.transform); view.previewMove(drag.id, drag.x, drag.y); drag = null;
  }
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || drag || error) return;
    const element = (event.target as Element).closest<SVGGElement>('[data-node]');
    const node = compiled.scene.nodes.find(item => item.id === element?.dataset.node);
    if (!node || !element || node.tap || !editable(compiled, node.id, 'x') || !editable(compiled, node.id, 'y')) return;
    const point = view.point(event.clientX, event.clientY);
    drag = { id: node.id, pointer: event.pointerId, x: Number(node.props.x), y: Number(node.props.y), startX: point.x, startY: point.y,
      dx: 0, dy: 0, element, transform: element.getAttribute('transform') ?? '' };
    canvas.setPointerCapture(event.pointerId); select(node.id);
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const point = view.point(event.clientX, event.clientY); drag.dx = point.x - drag.startX; drag.dy = point.y - drag.startY;
    drag.element.setAttribute('transform', `translate(${drag.dx} ${drag.dy}) ${drag.transform}`);
    view.previewMove(drag.id, drag.x + drag.dx, drag.y + drag.dy);
  });
  canvas.addEventListener('pointerup', event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const current = drag; drag = null; current.element.setAttribute('transform', current.transform);
    view.previewMove(current.id, current.x, current.y);
    if (Math.hypot(current.dx, current.dy) > 2) move(current.id, Math.round(current.x + current.dx), Math.round(current.y + current.dy));
  });
  canvas.addEventListener('pointercancel', cancelDrag); canvas.addEventListener('lostpointercapture', cancelDrag);
  canvas.addEventListener('keydown', event => {
    if (event.defaultPrevented) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo(editor) : undo(editor); }
    else if (event.key === 'Escape') { cancelDrag(); select(null); }
    else if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); view.fit(); }
    else if (selected && /^Arrow/.test(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const node = compiled.scene.nodes.find(item => item.id === selected);
      if (!node || node.tap || error || !editable(compiled, node.id, 'x') || !editable(compiled, node.id, 'y')) return;
      event.preventDefault(); const step = event.shiftKey ? 1 : 10;
      move(node.id, Number(node.props.x) + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
        Number(node.props.y) + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0));
    }
  });
  function layout() {
    shell.dataset.mobilePane = pane;
    $('studio-editor-pane').hidden = compact.matches && pane !== 'source';
    shell.querySelectorAll<HTMLButtonElement>('[data-demo-pane]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.demoPane === pane)));
    requestAnimationFrame(() => { editor.requestMeasure(); view.fit(); });
  }
  function animation() { view.paused = paused || !visible || document.hidden || compact.matches && pane === 'source'; }
  function playback() {
    const play = $('studio-play'), label = paused ? 'Продолжить демонстрацию' : 'Приостановить демонстрацию';
    play.setAttribute('aria-pressed', String(!paused)); play.setAttribute('aria-label', label); play.title = label;
    play.querySelector('use')!.setAttribute('href', paused ? '#i-play' : '#i-pause'); animation();
  }
  shell.querySelectorAll<HTMLButtonElement>('[data-demo-pane]').forEach(button => {
    button.onclick = () => { pane = button.dataset.demoPane === 'source' ? 'source' : 'scene'; layout(); animation(); };
  });
  $('studio-undo').onclick = () => { cancelDrag(); undo(editor); };
  $('studio-fit').onclick = () => view.fit();
  $('studio-play').onclick = () => { paused = !paused; playback(); };
  reset.onclick = () => { cancelDrag(); selected = null; editor.setState(state()); render(); layout(); $('studio-undo').setAttribute('disabled', ''); };
  $('studio-diagnostics').onclick = () => { pane = 'source'; layout(); editor.focus(); };
  window.addEventListener('resize', layout);
  document.addEventListener('visibilitychange', animation);
  reduced.addEventListener('change', () => { paused = reduced.matches; playback(); });
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; animation(); }, { rootMargin: '80px' }).observe(shell);
  render(); layout(); playback(); $('studio-undo').setAttribute('disabled', '');
}
