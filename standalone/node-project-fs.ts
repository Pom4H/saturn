import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { projectPath, type ProjectEntry, type ProjectFs, type ProjectStat } from '../src/project/fs';

export class NodeProjectFs implements ProjectFs {
  readonly root: string;
  constructor(root: string) { this.root = resolve(root); }

  private absolute(path: string): string {
    const normalized = projectPath(path);
    const absolute = resolve(this.root, normalized);
    const rel = relative(this.root, absolute);
    if (rel === '..' || rel.startsWith('..' + sep) || rel === '') {
      if (rel === '') return absolute;
      throw new Error('Project path escapes root');
    }
    return absolute;
  }

  async readFile(path: string) { return new Uint8Array(await readFile(this.absolute(path))); }

  async writeFile(path: string, data: Uint8Array) {
    const target = this.absolute(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  async readDir(path = ''): Promise<readonly ProjectEntry[]> {
    const directory = path ? this.absolute(path) : this.root;
    return (await readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.isFile() || entry.isDirectory())
      .map(entry => ({ name: entry.name, kind: entry.isDirectory() ? 'directory' as const : 'file' as const }));
  }

  async mkdir(path: string) { await mkdir(this.absolute(path), { recursive: true }); }
  async remove(path: string, options: { recursive?: boolean } = {}) { await rm(this.absolute(path), { recursive: !!options.recursive, force: true }); }
  async rename(from: string, to: string) {
    const target = this.absolute(to);
    await mkdir(dirname(target), { recursive: true });
    await rename(this.absolute(from), target);
  }

  async stat(path: string): Promise<ProjectStat | null> {
    try {
      const value = await stat(this.absolute(path));
      return value.isDirectory()
        ? { kind: 'directory', modifiedAt: value.mtimeMs }
        : value.isFile() ? { kind: 'file', size: value.size, modifiedAt: value.mtimeMs } : null;
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as Error & { code?: unknown }).code === 'ENOENT') return null;
      throw error;
    }
  }
}
