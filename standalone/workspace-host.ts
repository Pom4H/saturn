import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readText, writeText } from '../src/project/fs';
import { buildArtifact, type BuildArtifact } from '../plant/artifact';
import { loadProjectDirectory } from './project-loader';

const exec = promisify(execFile);

export interface WorkspaceSnapshot {
  id: string;
  sourceRevision: string | null;
  time: number;
  actor: 'filesystem';
  message: 'Workspace files';
  files: Record<string, string>;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function canonicalFiles(files: Record<string, string>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))));
}

export class WorkspaceHost {
  constructor(readonly directory: string) {}

  private async gitRevision(): Promise<string | null> {
    try {
      const { stdout } = await exec('git', ['-C', this.directory, 'rev-parse', 'HEAD'], {
        timeout: 5000,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async snapshot(): Promise<WorkspaceSnapshot> {
    const loaded = await loadProjectDirectory(this.directory);
    const id = 'workspace:' + await sha256(canonicalFiles(loaded.sources));
    const git = await this.gitRevision();
    return {
      id,
      sourceRevision: git,
      time: Date.now(),
      actor: 'filesystem',
      message: 'Workspace files',
      files: loaded.sources,
    };
  }

  async save(files: Record<string, string>, expected: string | null): Promise<WorkspaceSnapshot> {
    const before = await this.snapshot();
    if (expected !== before.id) throw new Error('Workspace changed; preserve your draft and reload the files');
    const loaded = await loadProjectDirectory(this.directory);
    for (const [path, source] of Object.entries(files)) {
      if (!/\.(?:ts|tsx|sql|json|md|css|svg)$/i.test(path)) throw new Error(`Unsupported workspace text file: ${path}`);
      await writeText(loaded.fs, path, source);
    }
    // Build immediately: invalid source never becomes a deployable workspace state.
    await this.build();
    return this.snapshot();
  }

  async build(): Promise<BuildArtifact> {
    const loaded = await loadProjectDirectory(this.directory);
    const sourceRevision = await this.gitRevision();
    let lockHash: string | undefined;
    for (const path of ['bun.lock', 'bun.lockb', 'package-lock.json']) {
      if (!await loaded.fs.stat(path)) continue;
      try { lockHash = await sha256(await readText(loaded.fs, path)); } catch {}
      break;
    }
    return buildArtifact(loaded.sources, {
      entry: 'src/plant.ts',
      packageName: loaded.packageName,
      ...(sourceRevision ? { sourceRevision } : {}),
      ...(lockHash ? { lockHash } : {}),
    });
  }
}
