import { openBrowserSql } from './browser-sql';
import { Store, LocalRepository } from '../store';
import { Service } from '../service';
import { demoFiles } from '../demo/files';
import { compileProject } from '../compiler';
import { AppError, type Actor, type ReportTask, type ReportArtifact } from '../types';
import { diagnosticLocale, errorPayload } from '../diagnostics';
const actor: Actor = { id: 'demo-engineer', role: 'engineer' };
let service: Service | null = null, initializing = false, ready = false, ticks = 0;
const scope = self;
function runReport(task: ReportTask): Promise<ReportArtifact> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./browser-report-worker.js', import.meta.url), { type: 'module' });
        const timer = setTimeout(() => { worker.terminate(); reject(new Error('Report exceeded 5 seconds')); }, 5000);
        const done = () => { clearTimeout(timer); worker.terminate(); };
        worker.onmessage = e => { done(); e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.result); };
        worker.onerror = e => { done(); reject(new Error(e.message)); };
        worker.postMessage(task);
    });
}
async function initialize(memory: boolean) {
    const open = async () => {
        const { db, persistent } = await openBrowserSql({ memory });
        const store = new Store(db);
        service = new Service(store, new LocalRepository(store), { reportRunner: runReport });
        await service.start(demoFiles);
        service.subscribe(frame => scope.postMessage({ event: 'frame', frame }));
        ready = true;
        scope.postMessage({ event: 'ready', persistent, status: await service.status(actor) });
        const pump = () => { try {
            if (service) {
                service.tick();
                if (++ticks % 10 === 0) {
                    service.schedule();
                    for (const message of store.db.all<{
                        id: string;
                        kind: string;
                        subject: string;
                    }>("SELECT id,kind,subject FROM outbox WHERE status='pending' LIMIT 20")) {
                        scope.postMessage({ event: 'notification', ...message });
                        store.db.exec("UPDATE outbox SET status='local' WHERE id=?", [message.id]);
                    }
                }
            }
        }
        catch (error) {
            scope.postMessage({ event: 'failure', error: error instanceof Error ? error.message : String(error) });
        } setTimeout(pump, service?.project.stepMs ?? 100); };
        setTimeout(pump, service.project.stepMs);
        if (!memory)
            await new Promise(() => { }); // Web Lock lifetime equals the owner worker's lifetime.
    };
    if (memory)
        return open();
    if (!navigator.locks)
        throw new AppError('Persistent demo requires Web Locks. Use an explicit in-memory session.');
    await navigator.locks.request('scada-plant-database', { ifAvailable: true }, async (lock) => { if (!lock)
        throw new AppError('This demo database is open in another tab. Close that tab first.', 409); await open(); });
}
scope.onmessage = async (e) => {
    const { id, action, input } = e.data ?? {};
    if (action === 'initialize') {
        if (initializing)
            return;
        initializing = true;
        void initialize(input?.memory === true).catch(error => scope.postMessage({ event: 'failure', error: error instanceof Error ? error.message : String(error) }));
        return;
    }
    try {
        if (!ready || !service)
            throw new AppError('Runtime is not ready', 503);
        let result: unknown;
        switch (action) {
            case 'firmware': result=service.firmware(input.controllerId,input.revision,actor);break;
            case 'session':
                result = await service.status(actor);
                break;
            case 'project':
                result = await service.files(actor);
                break;
            case 'revisions':
                result = (await service.repository.log()).map(({ files, ...meta }) => meta);
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
            case 'save':
                result = await service.save(input.files, input.expected, input.message, actor);
                break;
            case 'publish':
                result = await service.publish(input.revision, input.expected, actor);
                break;
            case 'rollback':
                result = await service.rollback(input.revision, input.expected, actor);
                break;
            case 'report':
                result = service.dispatch(input.reportId, input.inputs ?? {}, actor);
                break;
            case 'validate':
                result = compileProject(input.files);
                break;
            default: throw new AppError('Unknown operation');
        }
        scope.postMessage({ id, result });
    }
    catch (error) {
        scope.postMessage({ id, ...errorPayload(error, diagnosticLocale(navigator.language)), status: error instanceof AppError ? error.status : 500 });
    }
};
