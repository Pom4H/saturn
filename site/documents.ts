import { EditorState } from '@codemirror/state';
/** Document histories belong to paths; closing a tab never destroys a document. */
export class Documents {
  readonly states = new Map<string, EditorState>();
  readonly baseline: Record<string, string> = {};
  active: string;
  tabs: string[];
  preview: string | null = null;
  constructor(files: Record<string, string>, readonly makeState: (source: string, path: string) => EditorState, entry: string) {
    for (const [path, source] of Object.entries(files)) {
      const state = makeState(source, path);
      this.states.set(path, state);
      // CodeMirror canonicalizes line separators. Compare against the exact
      // representation the editor owns so CRLF checkouts are not all dirty.
      this.baseline[path] = state.doc.toString();
    }
    if (!this.states.has(entry)) throw new Error(`Нет файла ${entry}`);
    this.active = entry; this.tabs = [entry];
  }
  get state() { return this.states.get(this.active)!; }
  get files() { return Object.fromEntries([...this.states].map(([path, state]) => [path, state.doc.toString()])); }
  capture(state: EditorState) { this.states.set(this.active, state); if (this.dirty(this.active) && this.preview === this.active) this.preview = null; }
  dirty(path?: string): boolean { return path ? this.states.get(path)!.doc.toString() !== this.baseline[path] : [...this.states.keys()].some(path => this.dirty(path)); }
  open(path: string, pinned = false) {
    if (!this.states.has(path)) throw new Error(`Нет файла ${path}`);
    if (!this.tabs.includes(path)) {
      if (this.preview && !this.dirty(this.preview)) this.tabs = this.tabs.filter(p => p !== this.preview);
      this.tabs.push(path); this.preview = pinned ? null : path;
    } else if (pinned && this.preview === path) this.preview = null;
    this.active = path;
    return this.state;
  }
  close(path: string) {
    // Keep changed files visible; they can be committed, exported or reverted explicitly.
    if (this.dirty(path) || this.tabs.length === 1) return false;
    const index = this.tabs.indexOf(path); this.tabs = this.tabs.filter(p => p !== path);
    if (this.preview === path) this.preview = null;
    if (this.active === path) this.active = this.tabs[Math.max(0, index - 1)];
    return true;
  }
}
export interface ServerRevision { id: string; parent: string | null; time: number; actor: string; message: string; files: Record<string, string>; }
export async function fetchServerProject(): Promise<ServerRevision> {
  const response = await fetch('/plant/api/project', { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (response.status === 401 || response.status === 403) throw new Error('Войдите на сервер с ролью инженера, затем повторите загрузку.');
  if (!response.ok) throw new Error(`Сервер не отдал проект (HTTP ${response.status})`);
  const data = await response.json();
  if (!data || typeof data.id !== 'string' || !data.files || typeof data.files !== 'object' || Array.isArray(data.files)) throw new Error('Неверный ответ сервера');
  return data;
}
