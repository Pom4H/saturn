import './navigator.css';

export interface NavigatorState {
  paths: string[];
  active: string;
  dirty: ReadonlySet<string>;
  errors: ReadonlySet<string>;
  title: string;
}
interface Entry { path: string; name: string; folder: boolean; depth: number; parent: string; }
const compare = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

/** File navigation reflects a revision/document store. It never creates placeholder files. */
export class FileNavigator {
  private collapsed = new Set<string>();
  private entries: Entry[] = [];
  private focusPath = '';
  private signature = '';
  private changedOnly = false;
  private readonly tree = document.getElementById('file-tree')!;
  private readonly search = document.getElementById('file-search') as HTMLInputElement;
  private readonly changed = document.getElementById('files-changed') as HTMLButtonElement;
  private readonly results = document.getElementById('file-results')!;
  private readonly clear = document.getElementById('files-clear-search') as HTMLButtonElement;
  constructor(private readonly state: () => NavigatorState, private readonly open: (path: string, pinned: boolean) => void) {
    this.tree.setAttribute('role', 'tree');
    this.tree.setAttribute('aria-label', 'Файлы проекта');
    this.search.oninput = () => this.render(true);
    this.clear.onclick = () => { this.search.value = ''; this.render(true); this.search.focus(); };
    this.changed.onclick = () => { this.changedOnly = !this.changedOnly; this.render(true); };
    document.getElementById('files-collapse')!.onclick = () => {
      for (const path of this.state().paths) for (const parent of this.ancestors(path)) this.collapsed.add(parent);
      this.render(true);
    };
    document.getElementById('files-reveal')!.onclick = () => this.reveal();
    this.search.onkeydown = event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); this.focusRow(0); }
      if (event.key === 'Escape' && this.search.value) { event.preventDefault(); event.stopPropagation(); this.search.value = ''; this.render(true); }
    };
    this.tree.addEventListener('keydown', event => this.keydown(event));
  }
  private ancestors(path: string) { const parts = path.split('/'); return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/')); }
  reveal() {
    const path = this.state().active;
    this.search.value = ''; this.changedOnly = false;
    for (const parent of this.ancestors(path)) this.collapsed.delete(parent);
    this.focusPath = path; this.render(true);
    this.focusRow(this.entries.findIndex(entry => entry.path === path));
  }
  private rows() { return [...this.tree.querySelectorAll<HTMLButtonElement>('[role=treeitem]')]; }
  private focusRow(index: number) {
    const rows = this.rows(), row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (!row) return;
    for (const sibling of rows) sibling.tabIndex = sibling === row ? 0 : -1;
    this.focusPath = row.dataset.file ?? row.dataset.folder ?? '';
    row.focus(); row.scrollIntoView({ block: 'nearest' });
  }
  private keydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    const index = this.entries.findIndex(entry => entry.path === (target.dataset.file ?? target.dataset.folder));
    if (index < 0 || event.altKey || event.metaKey || event.ctrlKey) return;
    const entry = this.entries[index];
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); }
    if (event.key === 'ArrowDown') this.focusRow(index + 1);
    else if (event.key === 'ArrowUp') this.focusRow(index - 1);
    else if (event.key === 'Home') this.focusRow(0);
    else if (event.key === 'End') this.focusRow(this.entries.length - 1);
    else if (event.key === 'ArrowRight' && entry.folder) {
      if (this.collapsed.has(entry.path)) { this.collapsed.delete(entry.path); this.render(true); }
      else this.focusRow(index + 1);
    } else if (event.key === 'ArrowLeft') {
      if (entry.folder && !this.collapsed.has(entry.path)) { this.collapsed.add(entry.path); this.render(true); }
      else this.focusRow(this.entries.findIndex(item => item.path === entry.parent));
    } else if (event.key === 'Enter' || event.key === ' ') target.click();
  }
  render(force = false) {
    const state = this.state();
    const query = this.search.value.trim().toLocaleLowerCase();
    const signature = JSON.stringify([state.paths, state.active, [...state.dirty], [...state.errors], state.title, query, this.changedOnly, [...this.collapsed]]);
    if (!force && signature === this.signature) return;
    this.signature = signature;
    const focused = this.tree.contains(document.activeElement);
    const previousScroll = this.tree.scrollTop;
    const previousFocus = (document.activeElement as HTMLElement)?.dataset;
    if (focused) this.focusPath = previousFocus.file ?? previousFocus.folder ?? this.focusPath;
    document.getElementById('file-project-name')!.textContent = state.title;
    document.getElementById('file-project-name')!.title = state.title;
    this.changed.setAttribute('aria-pressed', String(this.changedOnly));
    this.changed.title = `Изменённые файлы: ${state.dirty.size}`;
    this.changed.querySelector('span')!.textContent = String(state.dirty.size);
    this.clear.hidden = !query;
    const paths = state.paths.filter(path => (!query || path.toLocaleLowerCase().includes(query)) && (!this.changedOnly || state.dirty.has(path)));
    this.results.textContent = query || this.changedOnly ? `${paths.length} / ${state.paths.length}` : `${state.paths.length}`;
    this.results.setAttribute('aria-label', `Показано файлов: ${paths.length} из ${state.paths.length}`);
    const flat = !!query || this.changedOnly;
    const nodes = new Map<string, Entry>();
    for (const path of paths) {
      const parts = path.split('/');
      if (!flat) for (const parent of this.ancestors(path)) {
        const parentParts = parent.split('/'); nodes.set(parent, { path: parent, name: parentParts.at(-1)!, folder: true, depth: parentParts.length - 1, parent: parentParts.slice(0, -1).join('/') });
      }
      nodes.set(path, { path, name: parts.at(-1)!, folder: false, depth: flat ? 0 : parts.length - 1, parent: flat ? '' : parts.slice(0, -1).join('/') });
    }
    const children = new Map<string, Entry[]>();
    for (const node of nodes.values()) { const group = children.get(node.parent) ?? []; group.push(node); children.set(node.parent, group); }
    this.entries = [];
    const append = (parent: string) => {
      for (const entry of (children.get(parent) ?? []).sort((a, b) => Number(b.folder) - Number(a.folder) || compare.compare(a.name, b.name))) {
        this.entries.push(entry);
        if (entry.folder && !this.collapsed.has(entry.path)) append(entry.path);
      }
    };
    append('');
    this.tree.replaceChildren();
    this.tree.dataset.search = String(flat);
    for (const entry of this.entries) {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'navigator-row'; row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', String(entry.depth + 1)); row.style.setProperty('--file-depth', String(entry.depth)); row.title = entry.path;
      row.dataset[entry.folder ? 'folder' : 'file'] = entry.path;
      row.dataset.dirty = String(state.dirty.has(entry.path)); row.dataset.error = String(state.errors.has(entry.path));
      row.tabIndex = -1;
      const chevron = document.createElement('span'); chevron.className = 'navigator-chevron'; chevron.innerHTML = entry.folder ? '<svg><path d="m9 6 6 6-6 6"/></svg>' : ''; chevron.setAttribute('aria-hidden', 'true');
      const icon = document.createElement('span'); icon.className = 'navigator-icon'; icon.setAttribute('aria-hidden', 'true');
      const ext = entry.name.split('.').at(-1)?.toLowerCase();
      icon.dataset.kind = entry.folder ? 'folder' : ext ?? 'file';
      icon.innerHTML = entry.folder ? '<svg><use href="#i-folder"/></svg>' : ext === 'ts' ? '<span>TS</span>' : ext === 'json' ? '<span>{ }</span>' : '<svg><path d="M6 3h8l4 4v14H6ZM14 3v5h4M9 12h6M9 16h4"/></svg>';
      const label = document.createElement('span'); label.className = 'navigator-label';
      const filename = document.createElement('span'); filename.textContent = entry.name; label.append(filename);
      if (flat && entry.path.includes('/')) { const path = document.createElement('small'); path.textContent = entry.path.slice(0, -entry.name.length - 1); label.append(path); }
      const mark = document.createElement('span'); mark.className = 'navigator-mark';
      if (state.errors.has(entry.path)) { mark.textContent = '!'; mark.setAttribute('aria-label', 'Ошибка'); }
      else if (state.dirty.has(entry.path)) { mark.textContent = 'M'; mark.setAttribute('aria-label', 'Изменён'); }
      row.append(chevron, icon, label, mark);
      if (entry.folder) {
        row.setAttribute('aria-expanded', String(!this.collapsed.has(entry.path)));
        row.onclick = () => { this.focusPath = entry.path; this.collapsed.has(entry.path) ? this.collapsed.delete(entry.path) : this.collapsed.add(entry.path); this.render(true); };
      } else {
        row.setAttribute('aria-selected', String(entry.path === state.active)); row.setAttribute('aria-current', entry.path === state.active ? 'page' : 'false');
        row.onclick = () => { this.focusPath = entry.path; this.open(entry.path, false); };
        row.ondblclick = () => this.open(entry.path, true);
      }
      row.onfocus = () => { this.focusPath = entry.path; for (const other of this.rows()) other.tabIndex = other === row ? 0 : -1; };
      this.tree.append(row);
    }
    if (!this.entries.length) {
      const empty = document.createElement('div'); empty.className = 'navigator-empty';
      empty.textContent = query ? 'Файлы не найдены' : this.changedOnly ? 'Нет изменений' : 'Нет файлов'; this.tree.append(empty);
    }
    const focusIndex = Math.max(0, this.entries.findIndex(entry => entry.path === this.focusPath || !this.focusPath && entry.path === state.active));
    const row = this.rows()[focusIndex]; if (row) row.tabIndex = 0;
    this.tree.scrollTop = previousScroll;
    if (focused) this.focusRow(focusIndex);
  }
}
