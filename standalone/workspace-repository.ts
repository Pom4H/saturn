import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { compileProject, validateFiles } from '../plant/compiler';
import { LocalRepository, Store } from '../plant/store';
import type { Repository, Revision } from '../plant/types';
import { loadProjectDirectory } from './project-loader';

/**
 * IDE/workspace repository.
 *
 * Source files stay ordinary files so a normal Git client can diff/commit/push
 * them. Saturn keeps a local revision journal for CAS/undo and notices external
 * changes (git checkout/pull, another editor) without making Git a runtime
 * dependency.
 */
export class WorkspaceRepository implements Repository {
    private readonly local: LocalRepository;
    private refreshing = false;

    constructor(readonly store: Store, readonly directory: string) {
        this.local = new LocalRepository(store, () => `workspace:${crypto.randomUUID()}`);
    }

    async initialize(seed: Record<string, string>): Promise<this> {
        validateFiles(seed);
        compileProject(seed);
        if (!await this.local.head()) {
            const first = await this.local.commit(seed, null, 'Open workspace', 'workspace');
            await this.local.publish(first.id, null);
        }
        return this;
    }

    head() { return this.local.head(); }
    desired() { return this.local.desired(); }
    publish(id: string, expected: string | null) { return this.local.publish(id, expected); }
    read(id: string) { return this.local.read(id); }
    log(limit?: number) { return this.local.log(limit); }

    private async writeFiles(files: Record<string, string>): Promise<void> {
        validateFiles(files);
        compileProject(files);
        for (const [path, source] of Object.entries(files)) {
            const target = resolve(this.directory, path);
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, source, 'utf8');
        }
        await writeFile(resolve(this.directory, 'scada.project.json'), JSON.stringify({
            version: 1,
            entry: 'plant.ts',
            files: Object.keys(files).sort(),
        }, null, 2) + '\n', 'utf8');
    }

    async commit(files: Record<string, string>, expected: string | null, message: string, actor: string): Promise<Revision> {
        if (await this.local.head() !== expected)
            return this.local.commit(files, expected, message, actor); // preserve the normal CAS error
        await this.writeFiles(files);
        return this.local.commit(files, expected, message, actor);
    }

    async refresh(): Promise<void> {
        if (this.refreshing)
            return;
        this.refreshing = true;
        try {
            const loaded = await loadProjectDirectory(this.directory);
            const head = await this.local.head();
            if (!head)
                return;
            const current = await this.local.read(head);
            const canonical = (files: Record<string, string>) => JSON.stringify(Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))));
            const before = canonical(current.files);
            const after = canonical(loaded.files);
            if (before === after)
                return;
            const revision = await this.local.commit(loaded.files, head, 'External workspace change', 'filesystem');
            await this.local.publish(revision.id, await this.local.desired());
        }
        finally {
            this.refreshing = false;
        }
    }
}
