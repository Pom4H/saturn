/** Host-neutral project filesystem. Project source is bytes on a filesystem, never a JSON/file-map domain model. */
export type ProjectEntry = { name: string; kind: 'file' | 'directory' };
export type ProjectStat = { kind: 'file' | 'directory'; size?: number; modifiedAt?: number };

export interface ProjectFs {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  readDir(path?: string): Promise<readonly ProjectEntry[]>;
  mkdir(path: string): Promise<void>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  stat(path: string): Promise<ProjectStat | null>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function projectPath(value: string): string {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error('Invalid project path');
  const clean = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!clean || clean.startsWith('/') || /^[A-Za-z]:\//.test(clean)) throw new Error('Project path must be relative');
  const parts = clean.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error('Project path traversal is not allowed');
  return parts.join('/');
}

export function joinProjectPath(...parts: string[]): string {
  return projectPath(parts.filter(Boolean).join('/'));
}

export function dirnameProjectPath(path: string): string {
  const value = projectPath(path);
  const at = value.lastIndexOf('/');
  return at < 0 ? '' : value.slice(0, at);
}

export async function exists(fs: ProjectFs, path: string): Promise<boolean> {
  return (await fs.stat(projectPath(path))) !== null;
}

export async function readText(fs: ProjectFs, path: string): Promise<string> {
  return decoder.decode(await fs.readFile(projectPath(path)));
}

export async function writeText(fs: ProjectFs, path: string, value: string): Promise<void> {
  path = projectPath(path);
  const parent = dirnameProjectPath(path);
  if (parent) await fs.mkdir(parent);
  await fs.writeFile(path, encoder.encode(value));
}

export async function walkProject(
  fs: ProjectFs,
  root = '',
  options: { ignore?: ReadonlySet<string> } = {},
): Promise<string[]> {
  const ignore = options.ignore ?? new Set(['.git', '.saturn', 'node_modules']);
  const result: string[] = [];
  const visit = async (directory: string) => {
    const entries = [...await fs.readDir(directory)].sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (ignore.has(entry.name)) continue;
      const path = directory ? joinProjectPath(directory, entry.name) : projectPath(entry.name);
      if (entry.kind === 'directory') await visit(path);
      else result.push(path);
    }
  };
  await visit(root);
  return result;
}

export class MemoryProjectFs implements ProjectFs {
  private files = new Map<string, Uint8Array>();
  private directories = new Set<string>(['']);

  constructor(seed: Record<string, string | Uint8Array> = {}) {
    for (const [path, value] of Object.entries(seed)) {
      const normalized = projectPath(path);
      this.ensureParents(normalized);
      this.files.set(normalized, typeof value === 'string' ? encoder.encode(value) : value.slice());
    }
  }

  private ensureParents(path: string) {
    const parts = path.split('/');
    parts.pop();
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      this.directories.add(current);
    }
  }

  async readFile(path: string) {
    const value = this.files.get(projectPath(path));
    if (!value) throw new Error(`Project file not found: ${path}`);
    return value.slice();
  }

  async writeFile(path: string, data: Uint8Array) {
    path = projectPath(path); this.ensureParents(path); this.files.set(path, data.slice());
  }

  async readDir(path = '') {
    const prefix = path ? projectPath(path) + '/' : '';
    if (path && !this.directories.has(projectPath(path))) throw new Error(`Project directory not found: ${path}`);
    const entries = new Map<string, ProjectEntry>();
    for (const directory of this.directories) {
      if (!directory.startsWith(prefix) || directory === path) continue;
      const rest = directory.slice(prefix.length);
      if (!rest || rest.includes('/')) continue;
      entries.set(rest, { name: rest, kind: 'directory' });
    }
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue;
      const rest = file.slice(prefix.length);
      if (!rest || rest.includes('/')) continue;
      entries.set(rest, { name: rest, kind: 'file' });
    }
    return [...entries.values()];
  }

  async mkdir(path: string) {
    path = projectPath(path);
    const parts = path.split('/');
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      this.directories.add(current);
    }
  }

  async remove(path: string, options: { recursive?: boolean } = {}) {
    path = projectPath(path);
    if (this.files.delete(path)) return;
    if (!this.directories.has(path)) return;
    const prefix = path + '/';
    if (!options.recursive && ([...this.files.keys()].some(x => x.startsWith(prefix)) || [...this.directories].some(x => x.startsWith(prefix))))
      throw new Error('Directory is not empty');
    for (const file of [...this.files.keys()]) if (file.startsWith(prefix)) this.files.delete(file);
    for (const directory of [...this.directories]) if (directory === path || directory.startsWith(prefix)) this.directories.delete(directory);
  }

  async rename(from: string, to: string) {
    from = projectPath(from); to = projectPath(to);
    const file = this.files.get(from);
    if (file) { this.ensureParents(to); this.files.set(to, file); this.files.delete(from); return; }
    if (!this.directories.has(from)) throw new Error(`Project path not found: ${from}`);
    const prefix = from + '/';
    const movedFiles = [...this.files].filter(([path]) => path.startsWith(prefix));
    const movedDirectories = [...this.directories].filter(path => path === from || path.startsWith(prefix));
    await this.remove(from, { recursive: true });
    await this.mkdir(to);
    for (const directory of movedDirectories) if (directory !== from) await this.mkdir(to + directory.slice(from.length));
    for (const [path, value] of movedFiles) await this.writeFile(to + path.slice(from.length), value);
  }

  async stat(path: string): Promise<ProjectStat | null> {
    path = projectPath(path);
    const file = this.files.get(path);
    if (file) return { kind: 'file', size: file.byteLength };
    return this.directories.has(path) ? { kind: 'directory' } : null;
  }

  snapshot(): Record<string, Uint8Array> {
    return Object.fromEntries([...this.files].map(([path, bytes]) => [path, bytes.slice()]));
  }
}
