import type { Frame, Project, Actor, Revision, ReportArtifact, ReportData } from '../types';
export interface Status {
    actor: Actor;
    project: Project;
    frame: Frame;
    head: string | null;
    desired: string | null;
    healthy: boolean;
    releaseError: string;
    overrides: Record<string, number>;
    csrf?: string;
    push?: {
        publicKey: string;
    } | null;
}
export interface Notice {
    id: string;
    kind: string;
    subject: string;
}
export interface Connection {
    request<T>(action: string, input?: unknown): Promise<T>;
    onFrame: (frame: Frame) => void;
    onFailure: (message: string) => void;
    onNotification: (notice: Notice) => void;
    close(): void;
    start(memory?: boolean): Promise<Status>;
}
export class LocalClient implements Connection {
    private worker: Worker;
    private counter = 0;
    private pending = new Map<number, {
        resolve: (v: any) => void;
        reject: (e: Error) => void;
        timer: ReturnType<typeof setTimeout>;
    }>();
    onFrame = (_frame: Frame) => { };
    onFailure = (_message: string) => { };
    onNotification = (_notice: Notice) => { };
    private resolveReady: (v: Status) => void = () => { };
    private rejectReady: (e: Error) => void = () => { };
    persistent = false;
    constructor() { this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); this.worker.onmessage = e => { const m = e.data; if (m.event === 'ready') {
        this.persistent = m.persistent;
        this.resolveReady(m.status);
    }
    else if (m.event === 'frame')
        this.onFrame(m.frame);
    else if (m.event === 'failure') {
        this.rejectReady(new Error(m.error));
        this.onFailure(m.error);
    }
    else if (m.event === 'notification')
        this.onNotification(m);
    else {
        const p = this.pending.get(m.id);
        if (p) {
            clearTimeout(p.timer);
            this.pending.delete(m.id);
            m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
        }
    } }; this.worker.onerror = e => { this.rejectReady(new Error(e.message)); this.onFailure(e.message); }; }
    start(memory = false): Promise<Status> { return new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; this.worker.postMessage({ action: 'initialize', input: { memory } }); }); }
    request<T>(action: string, input?: unknown): Promise<T> { return new Promise((resolve, reject) => { const id = ++this.counter, timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Worker request timed out')); }, 15000); this.pending.set(id, { resolve, reject, timer }); this.worker.postMessage({ id, action, input }); }); }
    close() { this.worker.terminate(); for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('Connection closed'));
    } this.pending.clear(); }
}
export class RemoteClient implements Connection {
    onFrame = (_frame: Frame) => { };
    onFailure = (_message: string) => { };
    onNotification = (_notice: Notice) => { };
    private csrf = '';
    private stream: EventSource | null = null;
    private lastFrame = 0;
    private watchdog: ReturnType<typeof setInterval> | undefined;
    constructor(readonly base = new URL('../api/', location.href)) { }
    async request<T>(action: string, input?: unknown): Promise<T> {
        let path = action, body = input;
        const query = new URLSearchParams();
        if (action === 'report-artifact') {
            path = 'report';
            query.set('id', (input as {
                id: string;
            }).id);
            body = undefined;
        }
        if (action === 'history') {
            const h = input as {
                signals: string[];
                from: number;
                to: number;
            };
            for (const [key, value] of Object.entries(h))
                query.set(key, String(value));
            body = undefined;
        }
        const url = new URL(path, this.base);
        url.search = query.toString();
        const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000), cache: 'no-store', redirect: 'error' });
        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
            throw new Error(error.error);
        }
        return action === 'report-artifact' ? { html: await response.text(), rows: [] } as T : await response.json();
    }
    async start(): Promise<Status> { const status = await this.request<Status>('session'); this.csrf = status.csrf!; this.lastFrame = performance.now(); this.stream = new EventSource(new URL('stream', this.base)); this.stream.addEventListener('frame', e => { try {
        const frame = JSON.parse((e as MessageEvent).data);
        if (!frame || !Number.isSafeInteger(frame.seq) || !frame.samples)
            throw new Error('Invalid server frame');
        this.lastFrame = performance.now();
        this.onFrame(frame);
    }
    catch (error) {
        this.onFailure(String(error));
    } }); this.stream.onerror = () => this.onFailure('Связь с сервером потеряна. Значения недостоверны; симуляция не подменяет сервер.'); this.watchdog = setInterval(() => { if (performance.now() - this.lastFrame > 15000)
        this.onFailure('Нет новых данных от сервера'); }, 2000); return status; }
    close() { this.stream?.close(); clearInterval(this.watchdog); }
}
export type { Frame, Project, Actor, Revision, ReportArtifact, ReportData };
