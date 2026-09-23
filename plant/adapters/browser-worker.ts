import { openBrowserSql } from './browser-sql';
import { Store } from '../store';
import { migrate } from '../migrations';
import { Service } from '../service';
import { demoFiles } from "../../examples/plant/files";
import { buildArtifact } from '../artifact';
import { AppError, type Actor, type ReportTask, type ReportArtifact } from '../types';
import { diagnosticLocale, errorPayload, failCode } from '../diagnostics';
import { MemoryProjectFs, readText, writeText, type ProjectFs } from '../../src/project/fs';
import { OpfsProjectFs } from '../../src/project/opfs';
import { openProject } from '../../src/project/project';

const actor: Actor = { id: 'demo-engineer', role: 'engineer' };
let service: Service | null = null, initializing = false, ready = false, ticks = 0;
let projectFs: ProjectFs | null = null;
const scope = self;

function runReport(task: ReportTask): Promise<ReportArtifact> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./browser-report-worker.js', import.meta.url), { type: 'module' });
        const timer = setTimeout(() => { worker.terminate(); reject(new Error('Report exceeded 5 seconds')); }, 5000);
        const done = () => { clearTimeout(timer); worker.terminate(); };
        worker.onmessage = event => { done(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result); };
        worker.onerror = event => { done(); reject(new Error(event.message)); };
        worker.postMessage(task);
    });
}

async function seedWorkspace(fs: ProjectFs): Promise<void> {
    if (await fs.stat('package.json')) return;
    await writeText(fs, 'package.json', JSON.stringify({
        name: '@saturn/demo',
        private: true,
        type: 'module',
        description: 'Saturn local PWA project',
        saturn: { title: 'Saturn demo' },
    }, null, 2) + '\n');
    for (const [path, source] of Object.entries(demoFiles)) {
        await writeText(fs, `src/${path}`, source);
    }
}

async function workspaceArtifact() {
    if (!projectFs) failCode('SATURN_RUNTIME_INVALID',{reason:'disabled'},{resource:'workspace'},{status:503});
    const opened = await openProject(projectFs);
    return buildArtifact(opened.sources, {
        entry: opened.descriptor.entry,
        packageName: opened.descriptor.name,
    });
}

async function workspaceSnapshot() {
    if (!projectFs) failCode('SATURN_RUNTIME_INVALID',{reason:'disabled'},{resource:'workspace'},{status:503});
    const opened = await openProject(projectFs);
    const artifact = await buildArtifact(opened.sources, {
        entry: opened.descriptor.entry,
        packageName: opened.descriptor.name,
    });
    return {
        id: artifact.hash,
        sourceRevision: null,
        time: Date.now(),
        actor: 'browser',
        message: 'Workspace files',
        files: opened.sources,
    };
}

async function saveWorkspace(files: Record<string, string>, expected: string | null) {
    if (!projectFs) failCode('SATURN_RUNTIME_INVALID',{reason:'disabled'},{resource:'workspace'},{status:503});
    const before = await workspaceSnapshot();
    if (before.id !== expected)
        failCode('SATURN_CONFLICT',{resource:'workspace',reason:'stateChanged'},{expected,actual:before.id},{status:409});
    for (const [path, source] of Object.entries(files)) await writeText(projectFs, path, source);
    await workspaceArtifact();
    return workspaceSnapshot();
}

async function initialize(memory: boolean) {
    const open = async () => {
        const { db, persistent } = await openBrowserSql({ memory });
        migrate(db);
        const store = new Store(db);
        projectFs = memory ? new MemoryProjectFs() : await OpfsProjectFs.open('saturn-project-demo');
        await seedWorkspace(projectFs);
        const artifact = await workspaceArtifact();
        service = new Service(store, { reportRunner: runReport });
        await service.start(artifact);
        service.subscribe(frame => scope.postMessage({ event: 'frame', frame }));
        ready = true;
        scope.postMessage({ event: 'ready', persistent, status: await service.status(actor) });

        const pump = () => {
            try {
                if (service) {
                    service.tick();
                    if (++ticks % 10 === 0) {
                        service.schedule();
                        for (const message of store.db.all<{ id: string; kind: string; subject: string }>(
                            "SELECT id,kind,subject FROM outbox WHERE status='pending' LIMIT 20",
                        )) {
                            scope.postMessage({ event: 'notification', ...message });
                            store.db.exec("UPDATE outbox SET status='local' WHERE id=?", [message.id]);
                        }
                    }
                }
            }
            catch (error) {
                scope.postMessage({ event: 'failure', error: error instanceof Error ? error.message : String(error) });
            }
            setTimeout(pump, service?.project.stepMs ?? 100);
        };
        setTimeout(pump, service.project.stepMs);

        if (!memory) await new Promise(() => {}); // Web Lock lifetime equals the owner worker's lifetime.
    };

    if (memory) return open();
    if (!navigator.locks)
        failCode('SATURN_RUNTIME_INVALID',{reason:'disabled'},{resource:'web-locks'});
    await navigator.locks.request('saturn-runtime-database-v2', { ifAvailable: true }, async lock => {
        if (!lock)
            failCode('SATURN_CONFLICT',{resource:'browser.database',reason:'stateChanged'},{lock:'saturn-runtime-database-v2'},{status:409});
        await open();
    });
}

scope.onmessage = async event => {
    const { id, action, input } = event.data ?? {};
    if (action === 'initialize') {
        if (initializing) return;
        initializing = true;
        void initialize(input?.memory === true).catch(error =>
            scope.postMessage({ event: 'failure', error: error instanceof Error ? error.message : String(error) }));
        return;
    }

    try {
        if (!ready || !service)
            failCode('SATURN_RUNTIME_INVALID',{reason:'disabled'},{resource:'browser-runtime'},{status:503});

        let result: unknown;
        switch (action) {
            case 'firmware':
                result = service.firmware(input.controllerId,input.revision,actor);
                break;
            case 'session':
                result = await service.status(actor);
                break;
            case 'workspace':
                result = await workspaceSnapshot();
                break;
            case 'workspace/save':
                result = await saveWorkspace(input.files, input.expected ?? null);
                break;
            case 'deploy':
                result = await service.deploy(input?.artifact ?? await workspaceArtifact(), input?.expected ?? service.store.published(), actor);
                break;
            case 'artifact':
                result = service.artifactInfo(actor);
                break;
            case 'events':
                result = service.store.events(service.kernel.state.runId);
                break;
            case 'reports':
                result = service.reports();
                break;
            case 'report-artifact':
                result = service.reportArtifact(input.id);
                break;
            case 'history':
                result = service.history(input.signals, input.from, input.to);
                break;
            case 'command':
                result = service.command(input, actor);
                break;
            case 'restart':
                result = await service.restart(actor);
                break;
            case 'rollback':
                result = await service.rollback(input.hash, input.expected ?? service.store.published(), actor);
                break;
            case 'report':
                result = service.dispatch(input.reportId, input.inputs ?? {}, actor);
                break;
            case 'validate': {
                const fs = new MemoryProjectFs(input.files);
                if (!await fs.stat('package.json')) {
                    const source = input.files['src/plant.ts'] ?? input.files['plant.ts'];
                    if (typeof source === 'string') {
                        await writeText(fs, 'package.json', '{"name":"@saturn/validation","private":true,"type":"module"}\n');
                        if (!input.files['src/plant.ts']) await writeText(fs, 'src/plant.ts', source);
                    }
                }
                const opened = await openProject(fs);
                result = await buildArtifact(opened.sources, { entry: opened.descriptor.entry, packageName: opened.descriptor.name });
                break;
            }
            default:
                failCode('SATURN_DSL_UNKNOWN',{kind:'browserOperation',name:String(action)},{action:String(action)});
        }
        scope.postMessage({ id, result });
    }
    catch (error) {
        scope.postMessage({ id, ...errorPayload(error, diagnosticLocale(navigator.language)), status: error instanceof AppError ? error.status : 500 });
    }
};
