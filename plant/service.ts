import { compileController } from './controller';
import { compileProject, validateFiles, validateProject } from './compiler';
import { Kernel } from './kernel';
import { acknowledge, updateAlarms } from './alarms';
import { Store } from './store';
import { cronMatches } from './workflows';
import { clone, finite, id, requireRole, type Actor, type AlarmState, type Event, type Frame, type Project, type Repository, type ReportTask, type ReportArtifact } from './types';
import { failCode, SaturnDiagnosticError } from './diagnostics';
const engineering: Actor = { id: 'system', role: 'engineer' };
const configuration = (p: Project) => JSON.stringify({ controllers:(p.controllers??[]).map(({layout,system,...c})=>c),connections:(p.connections??[]).map(({via,...w})=>w),attachments:p.attachments??[], simulations: p.simulations.map(({ layout, system, history, ...n }) => n).sort((a, b) => a.id.localeCompare(b.id)), signals: p.signals.map(({ unit, history, ...s }) => s), stepMs: p.stepMs, controls: p.controls ?? [] });
export class Service {
    kernel!: Kernel;
    project!: Project;
    alarms: Record<string, AlarmState> = {};
    healthy = true;
    releaseError = '';
    readonly instanceId: string;
    private listeners = new Set<(frame: Frame) => void>();
    private jobsRunning = false;
    private jobPromise: Promise<void> | null = null;
    private refreshing = false;
    private rejected: string | null = null;
    constructor(readonly store: Store, readonly repository: Repository, readonly options: {
        now?: () => number;
        uuid?: () => string;
        reportRunner: (task: ReportTask) => Promise<ReportArtifact>;
    }) {
        const existing = store.meta<string | null>('instanceId', null);
        this.instanceId = existing ?? crypto.randomUUID();
        if (!existing)
            store.set('instanceId', this.instanceId);
    }
    private now() { return (this.options.now ?? Date.now)(); }
    private uuid() { return (this.options.uuid ?? (() => crypto.randomUUID()))(); }
    async start(seed: Record<string, string>): Promise<void> {
        let head = await this.repository.head();
        if (!head) {
            compileProject(seed);
            head = (await this.repository.commit(seed, null, 'Initial demonstration project', 'system')).id;
            await this.repository.publish(head, null);
        }
        const saved = this.store.restore();
        if (saved) {
            validateProject(saved.project);
            this.project = saved.project;
            this.kernel = new Kernel(this.project, saved.state.revision, saved.state.runId, saved.state.epoch, saved.state);
            this.alarms = saved.alarms;
        }
        const desired = await this.repository.desired() ?? head;
        if (!saved || desired !== saved.state.revision) {
            try {
                await this.apply(desired, engineering);
            }
            catch (error) {
                if (!saved)
                    throw error;
                this.releaseError = error instanceof Error ? error.message : String(error);
            }
        }
        this.store.db.exec("UPDATE reports SET status='queued' WHERE status='running'");
        void this.runJobs().catch(() => { this.healthy = false; this.emit(); });
    }
    subscribe(fn: (frame: Frame) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    frame(): Frame { const frame = this.kernel.frame(); frame.alarms = clone(Object.values(this.alarms)); if (!this.healthy)
        for (const s of Object.values(frame.samples)) {
            s.value = null;
            s.quality = 'offline';
        } return frame; }
    private emit() { const frame = this.frame(); for (const fn of this.listeners) {
        try {
            fn(frame);
        }
        catch { /* One failed view must not stop ingestion. */ }
    } return frame; }
    private event(type: string, subject: string, detail: string, actor?: Actor): Event { return { id: this.uuid(), runId: this.kernel.state.runId, time: this.kernel.state.time, type, subject, detail, ...(actor ? { actor: actor.id } : {}) }; }
    private persist(events: Event[] = []) { const frame = this.kernel.frame(); this.store.save(this.project, this.kernel.state, this.alarms, frame, events, this.project.history, new Set(this.project.alarms.filter(a => a.notify).map(a => a.id))); }
    tick(): Frame {
        if (!this.healthy || this.kernel.state.paused)
            return this.frame();
        const before = clone(this.kernel.state), alarms = clone(this.alarms);
        try {
            const frame = this.kernel.step();
            const events = updateAlarms(this.project.alarms, this.alarms, frame);
            this.persist(events);
            if (frame.seq % 600 === 0)
                this.store.pruneProject(this.project, frame);
        }
        catch (error) {
            this.kernel.state = before;
            this.alarms = alarms;
            this.healthy = false;
            throw error;
        }
        return this.emit();
    }
    async save(files: Record<string, string>, expected: string | null, message: string, actor: Actor) { requireRole(actor, 'engineer'); validateFiles(files); compileProject(files); if (typeof message !== 'string' || !message.trim() || message.length > 200)
        failCode('SATURN_VALUE_INVALID',{field:'commit.message',reason:'range'},{min:1,max:200,value:message}); return this.repository.commit(files, expected, message, actor.id); }
    async publish(revision: string, expected: string | null, actor: Actor) { requireRole(actor, 'engineer'); const snapshot = await this.repository.read(revision); compileProject(snapshot.files); await this.repository.publish(revision, expected); await this.apply(revision, actor); return this.status(actor); }
    /** Git desired ref is durable first; SQLite applied checkpoint is authoritative for visible state.
     * A crash between them is reconciled by start(), retaining the last good checkpoint on rejection. */
    async apply(revision: string, actor: Actor) {
        const snapshot = await this.repository.read(revision), project = compileProject(snapshot.files);
        const compatible = this.kernel && configuration(this.project) === configuration(project);
        const checkpoint = compatible ? clone(this.kernel.state) : undefined;
        if (checkpoint)
            checkpoint.revision = revision;
        const kernel = new Kernel(project, revision, checkpoint?.runId ?? this.uuid(), checkpoint?.epoch ?? this.now(), checkpoint);
        const alarms = compatible && JSON.stringify(this.project.alarms) === JSON.stringify(project.alarms) ? clone(this.alarms) : {};
        const previous = { kernel: this.kernel, project: this.project, alarms: this.alarms };
        this.kernel = kernel;
        this.project = project;
        this.alarms = alarms;
        try {
            this.persist([this.event('release.applied', revision, `${compatible ? 'compatible' : 'new-run'}: ${snapshot.message}`, actor)]);
            this.healthy = true;
            this.releaseError = '';
        }
        catch (error) {
            Object.assign(this, previous);
            this.releaseError = 'Release persistence failed; previous revision is still active';
            throw error;
        }
        this.emit();
    }
    async rollback(revision: string, expected: string | null, actor: Actor) { requireRole(actor, 'engineer'); const old = await this.repository.read(revision); const commit = await this.save(old.files, expected, `Restore ${revision}`, actor); return this.publish(commit.id, await this.repository.desired(), actor); }
    command(payload: {
        id: string;
        revision: string;
        action: string;
        runId?: string;
        target?: string;
        parameter?: string;
        value?: number;
    }, actor: Actor) {
        requireRole(actor, 'operator');
        if (!this.healthy)
            failCode('SATURN_RUNTIME_INVALID',{reason:'disabled'},{resource:'storage'},{status:503});
        id(payload.id);
        if (payload.revision !== this.kernel.state.revision)
            failCode('SATURN_CONFLICT',{resource:'revision',reason:'stateChanged'},{expected:payload.revision,actual:this.kernel.state.revision});
        const encoded = JSON.stringify({ actor: actor.id, ...payload });
        const existing = this.store.db.all<{
            payload: string;
            receipt: string;
        }>('SELECT payload,receipt FROM commands WHERE id=?', [payload.id])[0];
        if (existing) {
            if (existing.payload !== encoded)
                failCode('SATURN_CONFLICT',{resource:'command',reason:'duplicate'},{id:payload.id},{status:409});
            return JSON.parse(existing.receipt);
        }
        const before = clone(this.kernel.state), alarms = clone(this.alarms);
        let event: Event;
        try {
            switch (payload.action) {
                case 'operate':
                    if (payload.runId !== this.kernel.state.runId) failCode('SATURN_CONFLICT',{resource:'run',reason:'stateChanged'},{expected:payload.runId,actual:this.kernel.state.runId},{status:409});
                    this.kernel.operate(payload.target!, payload.value!);
                    event = this.event('command.control', payload.target!, JSON.stringify({ requested: payload.value, actual: this.kernel.state.controls![payload.target!].value }), actor);
                    break;
                case 'set':
                    requireRole(actor, 'engineer');
                    this.kernel.setParameter(payload.target!, payload.parameter!, payload.value!);
                    event = this.event('command.parameter', payload.target!, `${payload.parameter}=${payload.value}`, actor);
                    break;
                case 'pause':
                    this.kernel.state.paused = true;
                    event = this.event('command.pause', 'simulation', 'Simulation paused', actor);
                    break;
                case 'resume':
                    this.kernel.state.paused = false;
                    event = this.event('command.resume', 'simulation', 'Simulation resumed', actor);
                    break;
                case 'ack':
                    acknowledge(this.alarms, payload.target!, actor, this.kernel.state.time);
                    event = this.event('alarm.acknowledged', payload.target!, 'Acknowledged', actor);
                    break;
                default: failCode('SATURN_DSL_UNKNOWN',{kind:'command',name:payload.action},{action:payload.action});
            }
            const receipt = { id: payload.id, status: payload.action === 'operate' ? 'accepted' : 'applied', seq: this.kernel.state.seq, runId: this.kernel.state.runId };
            // Commands and their effects share one SQLite transaction (save() is kept outside to avoid nested BEGIN).
            this.store.db.transaction(() => { this.store.db.exec('UPDATE checkpoints SET state=?,alarms=? WHERE run_id=?', [JSON.stringify(this.kernel.state), JSON.stringify(this.alarms), this.kernel.state.runId]); this.store.event(event); this.store.db.exec('INSERT INTO commands VALUES(?,?,?)', [payload.id, encoded, JSON.stringify(receipt)]); });
            this.emit();
            return receipt;
        }
        catch (error) {
            this.kernel.state = before;
            this.alarms = alarms;
            if (payload.action === 'operate' && error instanceof SaturnDiagnosticError) {
                try { this.store.event(this.event('command.rejected', payload.target ?? 'unknown', error.message, actor)); }
                catch { this.healthy = false; }
            }
            throw error;
        }
    }
    async restart(actor: Actor) { requireRole(actor, 'engineer'); const state = this.kernel.state; const old = this.kernel; this.kernel = new Kernel(this.project, state.revision, this.uuid(), this.now()); const alarms = this.alarms; this.alarms = {}; try {
        this.persist([this.event('simulation.restart', this.project.id, 'New simulation run', actor)]);
    }
    catch (error) {
        this.kernel = old;
        this.alarms = alarms;
        throw error;
    } this.healthy = true; return this.emit(); }
    history(signals: string[], from: number, to: number) { finite(from, 'from', 0, Number.MAX_SAFE_INTEGER); finite(to, 'to', from, this.kernel.state.time); return this.store.history(this.kernel.state.runId, signals, from, to); }
    async instance(actor: Actor) {
        return {
            protocol: 1,
            instanceId: this.instanceId,
            authority: 'runtime' as const,
            actor,
            projectId: this.project.id,
            head: await this.repository.head(),
            published: await this.repository.desired(),
            applied: this.kernel.state.revision,
            runId: this.kernel.state.runId,
            healthy: this.healthy,
        };
    }
    async status(actor: Actor) { return { actor, mode: 'simulation', project: this.project, frame: this.frame(), head: await this.repository.head(), desired: await this.repository.desired(), healthy: this.healthy, releaseError: this.releaseError, overrides: clone(this.kernel.state.overrides), instance: await this.instance(actor) }; }
    async files(actor: Actor) { requireRole(actor, 'engineer'); const head = await this.repository.head(); return head ? this.repository.read(head) : null; }
    firmware(controllerId:string, revision:string, actor:Actor) {
        requireRole(actor,'engineer');if(revision!==this.kernel.state.revision)failCode('SATURN_CONFLICT',{resource:'revision',reason:'stateChanged'},{expected:revision,actual:this.kernel.state.revision},{status:409});
        const c=this.project.controllers?.find(c=>c.id===controllerId);if(!c)failCode('SATURN_NOT_FOUND',{resource:'plc',id:controllerId},{controllerId},{status:404});
        const artifact=compileController(c);
        return { ...artifact,fbdbin:Array.from(artifact.fbdbin),revision,controllerId,
          connections:(this.project.connections??[]).filter(w=>w.from.device===controllerId||w.to.device===controllerId),
          expansions:(this.project.attachments??[]).filter(a=>a.controller===controllerId),
          limitations:['Program data for the pinned FBD runtime, not bootloader/HAL firmware','Virtual expansions are not compiled into physical Saturn addresses','No physical device deployment or electrical qualification has been performed'] };
    }
    reports() { return this.store.db.all('SELECT id,report_id AS reportId,run_id AS runId,revision,trigger,actor,created_at AS createdAt,status,error FROM reports ORDER BY created_at DESC,rowid DESC LIMIT 100'); }
    reportArtifact(name: string) { const row = this.store.db.all<{
        artifact: string | null;
        status: string;
    }>('SELECT artifact,status FROM reports WHERE id=?', [name])[0]; if (!row)
        failCode('SATURN_NOT_FOUND',{resource:'report',id:name},{id:name},{status:404}); if (!row.artifact)
        failCode('SATURN_CONFLICT',{resource:'report',reason:'stateChanged'},{id:name,status:row.status},{status:409}); return JSON.parse(row.artifact) as ReportArtifact; }
    private makeTask(reportId: string, trigger: string, actor: Actor, inputs: Record<string, number>, now: number): ReportTask {
        const report = this.project.reports.find(r => r.id === reportId);
        if (!report)
            failCode('SATURN_NOT_FOUND',{resource:'report',id:reportId},{reportId},{status:404});
        const definitions = report.on.workflow_dispatch?.inputs ?? {}, resolved: Record<string, number> = {};
        for (const name of Object.keys(inputs))
            if (!(name in definitions))
                failCode('SATURN_DSL_UNKNOWN',{kind:'reportInput',name},{reportId,input:name});
        for (const [name, d] of Object.entries(definitions))
            resolved[name] = finite(inputs[name] ?? d.default, name, d.min, d.max);
        const to = this.kernel.state.time, from = Math.max(this.kernel.state.epoch, to - report.window);
        return { id: this.uuid(), report: clone(report), revision: this.kernel.state.revision, runId: this.kernel.state.runId, trigger, actor: actor.id, createdAt: now, from, to, inputs: resolved, data: this.store.history(this.kernel.state.runId, report.signals, from, to, 50000) };
    }
    private queue(task: ReportTask) { this.store.db.exec("INSERT INTO reports VALUES(?,?,?,?,?,?,?,'queued',?,NULL,NULL)", [task.id, task.report.id, task.runId, task.revision, task.trigger, task.actor, task.createdAt, JSON.stringify(task)]); }
    dispatch(reportId: string, inputs: Record<string, number>, actor: Actor) { requireRole(actor, 'operator'); const report = this.project.reports.find(r => r.id === reportId); if (!report?.on.workflow_dispatch)
        failCode('SATURN_RUNTIME_INVALID',{reason:'disabled'},{resource:'report',reportId}); if (this.store.db.all("SELECT id FROM reports WHERE status IN ('queued','running')").length >= 8)
        failCode('SATURN_LIMIT',{resource:'report.queue',reason:'queueFull'},{max:8},{status:429}); const task = this.makeTask(reportId, 'workflow_dispatch', actor, inputs, this.now()); this.store.db.transaction(() => this.queue(task)); void this.runJobs().catch(() => { this.healthy = false; this.emit(); }); return { id: task.id, status: 'queued' }; }
    schedule(now = this.now()) {
        const slot = Math.floor(now / 60000) * 60000;
        for (const report of this.project.reports) {
            if (!report.on.schedule?.some(s => cronMatches(s.cron, slot)))
                continue;
            const key = `${report.id}:${slot}`;
            if (this.store.db.all('SELECT id FROM schedule_slots WHERE id=?', [key]).length)
                continue;
            if (this.store.db.all("SELECT id FROM reports WHERE status IN ('queued','running')").length >= 8)
                continue;
            const task = this.makeTask(report.id, 'schedule', engineering, {}, now);
            this.store.db.transaction(() => { this.store.db.exec('INSERT INTO schedule_slots VALUES(?,?)', [key, slot]); this.queue(task); });
        }
        void this.runJobs().catch(() => { this.healthy = false; this.emit(); });
    }
    runJobs(): Promise<void> { if (this.jobPromise)
        return this.jobPromise; this.jobPromise = this.workJobs().finally(() => this.jobPromise = null); return this.jobPromise; }
    async idle() { await this.jobPromise; }
    async refreshRelease() { if (this.refreshing)
        return; this.refreshing = true; try {
        await this.repository.refresh?.();
        const desired = await this.repository.desired();
        if (desired && desired !== this.kernel.state.revision && desired !== this.rejected) {
            try {
                await this.apply(desired, engineering);
                this.rejected = null;
            }
            catch (error) {
                this.rejected = desired;
                this.releaseError = String(error instanceof Error ? error.message : error);
            }
        }
    }
    finally {
        this.refreshing = false;
    } }
    private async workJobs() {
        if (this.jobsRunning)
            return;
        this.jobsRunning = true;
        try {
            for (;;) {
                const row = this.store.db.all<{
                    id: string;
                    task: string;
                }>("SELECT id,task FROM reports WHERE status='queued' ORDER BY created_at,rowid LIMIT 1")[0];
                if (!row)
                    break;
                const task = JSON.parse(row.task) as ReportTask;
                this.store.db.exec("UPDATE reports SET status='running' WHERE id=?", [row.id]);
                try {
                    const artifact = await this.options.reportRunner(task);
                    this.store.db.transaction(() => { this.store.db.exec("UPDATE reports SET status='success',artifact=? WHERE id=?", [JSON.stringify(artifact), row.id]); if (task.report.notify)
                        this.store.notify(`report:${row.id}`, this.now(), 'report', row.id); });
                }
                catch (error) {
                    this.store.db.exec("UPDATE reports SET status='failure',error=? WHERE id=?", [String(error instanceof Error ? error.message : error).slice(0, 500), row.id]);
                }
            }
        }
        finally {
            this.jobsRunning = false;
        }
    }
}
