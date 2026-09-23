import { dirnameProjectPath, projectPath, type ProjectEntry, type ProjectFs, type ProjectStat } from './fs';

async function directory(root: FileSystemDirectoryHandle, path: string, create = false): Promise<FileSystemDirectoryHandle> {
  let current = root;
  if (!path) return current;
  for (const part of projectPath(path).split('/')) current = await current.getDirectoryHandle(part, { create });
  return current;
}

export class OpfsProjectFs implements ProjectFs {
  constructor(readonly root: FileSystemDirectoryHandle) {}

  static async open(name = 'saturn-projects') {
    const storage = await navigator.storage.getDirectory();
    return new OpfsProjectFs(await storage.getDirectoryHandle(name, { create: true }));
  }

  async readFile(path: string) {
    path = projectPath(path);
    const parent = await directory(this.root, dirnameProjectPath(path));
    const handle = await parent.getFileHandle(path.split('/').at(-1)!);
    return new Uint8Array(await (await handle.getFile()).arrayBuffer());
  }

  async writeFile(path: string, data: Uint8Array) {
    path = projectPath(path);
    const parent = await directory(this.root, dirnameProjectPath(path), true);
    const handle = await parent.getFileHandle(path.split('/').at(-1)!, { create: true });
    const writable = await handle.createWritable();
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    try { await writable.write(copy.buffer); } finally { await writable.close(); }
  }

  async readDir(path = ''): Promise<readonly ProjectEntry[]> {
    const handle = await directory(this.root, path);
    const entries: ProjectEntry[] = [];
    for await (const [name, child] of handle.entries()) entries.push({ name, kind: child.kind });
    return entries;
  }

  async mkdir(path: string) { await directory(this.root, projectPath(path), true); }

  async remove(path: string, options: { recursive?: boolean } = {}) {
    path = projectPath(path);
    const parent = await directory(this.root, dirnameProjectPath(path));
    await parent.removeEntry(path.split('/').at(-1)!, { recursive: !!options.recursive });
  }

  async rename(from: string, to: string) {
    const source = await this.readFile(from);
    await this.writeFile(to, source);
    await this.remove(from);
  }

  async stat(path: string): Promise<ProjectStat | null> {
    path = projectPath(path);
    try {
      const parent = await directory(this.root, dirnameProjectPath(path));
      const name = path.split('/').at(-1)!;
      try {
        const file = await (await parent.getFileHandle(name)).getFile();
        return { kind: 'file', size: file.size, modifiedAt: file.lastModified };
      } catch {
        await parent.getDirectoryHandle(name);
        return { kind: 'directory' };
      }
    } catch { return null; }
  }
}
