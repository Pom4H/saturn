import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface RecentProject {
    path: string;
    id: string;
    title: string;
    openedAt: number;
}

interface WorkspaceState {
    version: 1;
    recent: RecentProject[];
}

export class WorkspaceRegistry {
    constructor(readonly path: string) {}

    async read(): Promise<WorkspaceState> {
        try {
            const value = JSON.parse(await readFile(this.path, 'utf8'));
            if (value?.version !== 1 || !Array.isArray(value.recent))
                throw new Error('Invalid workspace registry');
            return { version: 1, recent: value.recent.slice(0, 20) };
        } catch (error: unknown) {
            if (error instanceof Error && 'code' in error && (error as Error & {code?:unknown}).code === 'ENOENT')
                return { version: 1, recent: [] };
            throw error;
        }
    }

    async touch(project: Omit<RecentProject, 'openedAt'>): Promise<void> {
        const state = await this.read();
        const path = resolve(project.path);
        state.recent = [
            { ...project, path, openedAt: Date.now() },
            ...state.recent.filter(item => resolve(item.path) !== path),
        ].slice(0, 20);
        await mkdir(dirname(this.path), { recursive: true });
        const temporary = this.path + '.tmp';
        await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
        await rename(temporary, this.path);
    }
}
