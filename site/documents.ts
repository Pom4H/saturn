import { EditorState } from '@codemirror/state';

/** Editor buffers belong to file paths. Project storage belongs to ProjectFs/workspace host. */
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
      this.baseline[path] = state.doc.toString();
    }
    if (!this.states.has(entry)) throw new Error(`Нет файла ${entry}`);
    this.active = entry;
    this.tabs = [entry];
  }

  get state() { return this.states.get(this.active)!; }
  get files() { return Object.fromEntries([...this.states].map(([path, state]) => [path, state.doc.toString()])); }

  capture(state: EditorState) {
    this.states.set(this.active, state);
    if (this.dirty(this.active) && this.preview === this.active) this.preview = null;
  }

  dirty(path?: string): boolean {
    return path
      ? this.states.get(path)!.doc.toString() !== this.baseline[path]
      : [...this.states.keys()].some(item => this.dirty(item));
  }

  markSaved(files: Record<string, string>) {
    for (const [path, state] of this.states) this.baseline[path] = files[path] ?? state.doc.toString();
  }

  open(path: string, pinned = false) {
    if (!this.states.has(path)) throw new Error(`Нет файла ${path}`);
    if (!this.tabs.includes(path)) {
      if (this.preview && !this.dirty(this.preview)) this.tabs = this.tabs.filter(item => item !== this.preview);
      this.tabs.push(path);
      this.preview = pinned ? null : path;
    } else if (pinned && this.preview === path) this.preview = null;
    this.active = path;
    return this.state;
  }

  close(path: string) {
    if (this.dirty(path) || this.tabs.length === 1) return false;
    const index = this.tabs.indexOf(path);
    this.tabs = this.tabs.filter(item => item !== path);
    if (this.preview === path) this.preview = null;
    if (this.active === path) this.active = this.tabs[Math.max(0, index - 1)];
    return true;
  }
}

export interface ServerWorkspaceSnapshot {
  id: string;
  sourceRevision: string | null;
  time: number;
  actor: string;
  message: string;
  files: Record<string, string>;
}

export async function fetchServerWorkspace(): Promise<ServerWorkspaceSnapshot> {
  const response = await fetch('/plant/api/workspace', {
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 401 || response.status === 403) throw new Error('Войдите на workspace host с ролью инженера, затем повторите загрузку.');
  if (!response.ok) throw new Error(`Workspace host не отдал файлы (HTTP ${response.status})`);
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Неверный ответ workspace host');
  const value = data as Partial<ServerWorkspaceSnapshot>;
  if (typeof value.id !== 'string' || !value.files || typeof value.files !== 'object' || Array.isArray(value.files))
    throw new Error('Неверный ответ workspace host');
  return value as ServerWorkspaceSnapshot;
}
