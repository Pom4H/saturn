import { AppError, type SqlDatabase, type Checkpoint, type Frame, type Event, type AlarmState, type HistoryPolicy, type Revision, type Repository, type ReportData, type Project, type WorkerJob, type WorkerJobKind } from './types';
export class Store {
    private last = new Map<string, {
        time: number;
        value: number | null;
        quality: string;
    } | undefined>();
    private projectSource: unknown;
    private projectJson = '';
    constructor(readonly db: SqlDatabase) {
        db.exec(`
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS checkpoints(run_id TEXT PRIMARY KEY,project TEXT NOT NULL,state TEXT NOT NULL,alarms TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS samples(run_id TEXT NOT NULL,signal TEXT NOT NULL,time INTEGER NOT NULL,value REAL,quality TEXT NOT NULL,PRIMARY KEY(run_id,signal,time));
    CREATE INDEX IF NOT EXISTS samples_time ON samples(run_id,time);
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,time INTEGER NOT NULL,type TEXT NOT NULL,subject TEXT NOT NULL,actor TEXT,detail TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS commits(id TEXT PRIMARY KEY,parent TEXT,time INTEGER NOT NULL,actor TEXT NOT NULL,message TEXT NOT NULL,files TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,report_id TEXT NOT NULL,run_id TEXT NOT NULL,revision TEXT NOT NULL,trigger TEXT NOT NULL,actor TEXT NOT NULL,created_at INTEGER NOT NULL,status TEXT NOT NULL,task TEXT NOT NULL,artifact TEXT,error TEXT);
    CREATE TABLE IF NOT EXISTS schedule_slots(id TEXT PRIMARY KEY,time INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,time INTEGER NOT NULL,kind TEXT NOT NULL,subject TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending');
    CREATE TABLE IF NOT EXISTS commands(id TEXT PRIMARY KEY,payload TEXT NOT NULL,receipt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS subscriptions(endpoint TEXT PRIMARY KEY,user_id TEXT NOT NULL,session_id TEXT NOT NULL,subscription TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS deliveries(event_id TEXT NOT NULL,endpoint TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(event_id,endpoint));
    CREATE TABLE IF NOT EXISTS worker_jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,actor TEXT NOT NULL,created_at INTEGER NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL,result TEXT,error TEXT,worker_id TEXT,lease_until INTEGER);
    CREATE INDEX IF NOT EXISTS worker_jobs_queue ON worker_jobs(status,kind,created_at);
  `);
    }
    enqueueWorker(job:WorkerJob):void {
        this.db.exec('INSERT INTO worker_jobs(id,kind,actor,created_at,status,payload) VALUES(?,?,?,?,?,?)',[job.id,job.kind,job.actor,job.createdAt,'queued',JSON.stringify(job.payload)]);
    }
    workerJobs(limit=100):WorkerJob[] {
        return this.db.all<any>('SELECT id,kind,actor,created_at AS createdAt,status,payload,result,error FROM worker_jobs ORDER BY created_at DESC LIMIT ?',[Math.min(limit,100)]).map(row=>({...row,payload:JSON.parse(row.payload),...(row.result?{result:JSON.parse(row.result)}:{})}));
    }
    claimWorker(kinds:readonly WorkerJobKind[],workerId:string,now=Date.now(),leaseMs=60000):WorkerJob|null {
        if(!kinds.length)return null;
        return this.db.transaction(()=>{
            this.db.exec("UPDATE worker_jobs SET status='queued',worker_id=NULL,lease_until=NULL WHERE status='running' AND lease_until<?",[now]);
            const marks=kinds.map(()=>'?').join(','),row=this.db.all<any>(`SELECT * FROM worker_jobs WHERE status='queued' AND kind IN (${marks}) ORDER BY created_at LIMIT 1`,[...kinds])[0];
            if(!row)return null;
            this.db.exec("UPDATE worker_jobs SET status='running',worker_id=?,lease_until=? WHERE id=? AND status='queued'",[workerId,now+leaseMs,row.id]);
            return {id:row.id,kind:row.kind,actor:row.actor,createdAt:row.created_at,status:'running',payload:JSON.parse(row.payload)} as WorkerJob;
        });
    }
    completeWorker(id:string,workerId:string,result:unknown,error?:string):void {
        const row=this.db.all<any>("SELECT worker_id,status FROM worker_jobs WHERE id=?",[id])[0];
        if(!row||row.status!=='running'||row.worker_id!==workerId)throw new AppError('Worker lease lost',409);
        this.db.exec("UPDATE worker_jobs SET status=?,result=?,error=?,worker_id=NULL,lease_until=NULL WHERE id=?",[error?'failure':'success',error?null:JSON.stringify(result??null),error?.slice(0,1000)??null,id]);
    }
    meta<T>(key: string, fallback: T): T { const row = this.db.all<{
        value: string;
    }>('SELECT value FROM meta WHERE key=?', [key])[0]; return row ? JSON.parse(row.value) : fallback; }
    set(key: string, value: unknown): void { this.db.exec('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, JSON.stringify(value)]); }
    event(event: Event) { this.db.exec('INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?,?)', [event.id, event.runId, event.time, event.type, event.subject, event.actor ?? null, event.detail]); }
    notify(id: string, time: number, kind: string, subject: string) { this.db.exec('INSERT OR IGNORE INTO outbox(id,time,kind,subject) VALUES(?,?,?,?)', [id, time, kind, subject]); }
    save(project: Project, state: Checkpoint, alarms: Record<string, AlarmState>, frame: Frame, events: Event[], history: HistoryPolicy, notifiable: Set<string>): void {
        const policies = this.policies(project);
        const updates = new Map<string, {
            time: number;
            value: number | null;
            quality: string;
        }>();
        if (this.projectSource !== project) {
            this.projectSource = project;
            this.projectJson = JSON.stringify(project);
        }
        this.db.transaction(() => {
            this.db.exec('INSERT INTO checkpoints VALUES(?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET state=excluded.state,alarms=excluded.alarms,project=excluded.project', [state.runId, this.projectJson, JSON.stringify(state), JSON.stringify(alarms)]);
            this.set('activeRun', state.runId);
            for (const [name, s] of Object.entries(frame.samples)) {
                const key = state.runId + ':' + name;
                if (!this.last.has(key))
                    this.last.set(key, this.db.all<{
                        time: number;
                        value: number | null;
                        quality: string;
                    }>('SELECT time,value,quality FROM samples WHERE run_id=? AND signal=? ORDER BY time DESC LIMIT 1', [state.runId, name])[0]);
                const previous = this.last.get(key);
                const policy = policies.get(name) ?? history;
                if (!previous || previous.quality !== s.quality || (previous.value === null) !== (s.value === null) || Math.abs((previous.value ?? 0) - (s.value ?? 0)) > policy.deadband || s.time - previous.time >= policy.maxInterval) {
                    this.db.exec('INSERT OR REPLACE INTO samples VALUES(?,?,?,?,?)', [state.runId, name, s.time, s.value, s.quality]);
                    updates.set(key, s);
                }
            }
            for (const e of events) {
                this.event(e);
                if (notifiable.has(e.subject) && e.type === 'alarm.raised')
                    this.notify(e.id, Date.now(), 'alarm', e.subject);
            }
        });
        for (const [key, value] of updates)
            this.last.set(key, value);
    }
    policies(project: Project): Map<string, HistoryPolicy> { return new Map([...(project.sources??[]).filter(s=>s.history).map(s=>[s.id,s.history!] as const), ...project.signals.filter(s => s.history).map(s => [s.id, s.history!] as const), ...project.simulations.flatMap(n => Object.entries(n.history ?? {}).map(([key, value]) => [`${n.id}.${key}`, value] as const))]); }
    pruneProject(project: Project, frame: Frame) { const policies = this.policies(project); this.db.transaction(() => { for (const name of Object.keys(frame.samples)) {
        const before = frame.time - (policies.get(name) ?? project.history).retention;
        this.db.exec('DELETE FROM samples WHERE run_id=? AND signal=? AND time<? AND time < COALESCE((SELECT MAX(time) FROM samples WHERE run_id=? AND signal=? AND time<?),-1)', [frame.runId, name, before, frame.runId, name, before]);
    } }); }
    restore(): {
        project: any;
        state: Checkpoint;
        alarms: Record<string, AlarmState>;
    } | null { const runId = this.meta<string | null>('activeRun', null); if (!runId)
        return null; const row = this.db.all<{
        project: string;
        state: string;
        alarms: string;
    }>('SELECT project,state,alarms FROM checkpoints WHERE run_id=?', [runId])[0]; return row ? { project: JSON.parse(row.project), state: JSON.parse(row.state), alarms: JSON.parse(row.alarms) } : null; }
    events(runId: string, limit = 200): Event[] { return this.db.all('SELECT id,run_id AS runId,time,type,subject,actor,detail FROM events WHERE run_id=? ORDER BY time DESC,id DESC LIMIT ?', [runId, limit]); }
    history(runId: string, signals: string[], from: number, to: number, limit = 20000): ReportData {
        if (signals.length > 64 || to < from || to - from > 7 * 86400000)
            throw new AppError('History range too large');
        const samples: ReportData['samples'] = [], segments: ReportData['segments'] = [];
        for (const signal of signals) {
            const previous = this.db.all<{
                signal: string;
                time: number;
                value: number | null;
                quality: string;
            }>('SELECT signal,time,value,quality FROM samples WHERE run_id=? AND signal=? AND time<? ORDER BY time DESC LIMIT 1', [runId, signal, from]);
            const points = this.db.all<ReportData['samples'][number]>('SELECT signal,time,value,quality FROM samples WHERE run_id=? AND signal=? AND time>=? AND time<=? ORDER BY time LIMIT ?', [runId, signal, from, to, limit + 1]);
            if (samples.length + points.length > limit)
                throw new AppError('History exceeds row budget; shorten the window');
            samples.push(...points);
            const all = [...previous, ...points];
            for (let i = 0; i < all.length; i++) {
                const s = all[i], start = Math.max(s.time, from), end = Math.min(all[i + 1]?.time ?? to, to);
                if (end > start)
                    segments.push({ signal, start, end, value: s.value, quality: s.quality });
            }
        }
        return { samples, segments };
    }
    prune(runId: string, before: number): void { this.db.exec(`DELETE FROM samples WHERE run_id=? AND time<? AND (signal,time) NOT IN (SELECT signal,MAX(time) FROM samples WHERE run_id=? AND time<? GROUP BY signal)`, [runId, before, runId, before]); }
}
export class LocalRepository implements Repository {
    constructor(readonly store: Store, private makeId = () => `local:${crypto.randomUUID()}`) { }
    async head() { return this.store.meta<string | null>('head', null); }
    async desired() { return this.store.meta<string | null>('desired', null); }
    async publish(id: string, expected: string | null) { this.store.db.transaction(() => { if (this.store.meta('desired', null) !== expected)
        throw new AppError('Release changed', 409); if (!this.store.db.all('SELECT id FROM commits WHERE id=?', [id]).length)
        throw new AppError('Unknown revision'); this.store.set('desired', id); }); }
    async read(id: string): Promise<Revision> { const row = this.store.db.all<any>('SELECT * FROM commits WHERE id=?', [id])[0]; if (!row)
        throw new AppError('Unknown revision', 404); return { ...row, files: JSON.parse(row.files) }; }
    async log(limit = 100) { return this.store.db.all<any>('SELECT * FROM commits ORDER BY time DESC,rowid DESC LIMIT ?', [Math.min(limit, 100)]).map(r => ({ ...r, files: JSON.parse(r.files) })); }
    async commit(files: Record<string, string>, expected: string | null, message: string, actor: string): Promise<Revision> { return this.store.db.transaction(() => { if (this.store.meta('head', null) !== expected)
        throw new AppError('Revision changed; preserve your draft and refresh', 409); const revision: Revision = { id: this.makeId(), parent: expected, time: Date.now(), actor, message, files }; this.store.db.exec('INSERT INTO commits VALUES(?,?,?,?,?,?)', [revision.id, expected, revision.time, actor, message, JSON.stringify(files)]); this.store.set('head', revision.id); return revision; }); }
}
