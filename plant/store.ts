import type { SqlDatabase, Checkpoint, Frame, Event, AlarmState, HistoryPolicy, ReportData, Project } from './types';
import type { BuildArtifact } from './artifact';
import { validateBuildArtifact } from './artifact';
import { migrate } from './migrations';
import { failCode } from './diagnostics';

export class Store {
    private last = new Map<string, { time: number; value: number | null; quality: string } | undefined>();

    constructor(readonly db: SqlDatabase) {
        migrate(db);
    }

    meta<T>(key: string, fallback: T): T {
        const row = this.db.all<{ value: string }>('SELECT value FROM meta WHERE key=?', [key])[0];
        return row ? JSON.parse(row.value) : fallback;
    }

    set(key: string, value: unknown): void {
        this.db.exec('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, JSON.stringify(value)]);
    }

    putArtifact(artifact: BuildArtifact): void {
        validateBuildArtifact(artifact);
        this.db.exec('INSERT OR IGNORE INTO artifacts(hash,document) VALUES(?,?)', [artifact.hash, JSON.stringify(artifact)]);
    }

    artifact(hash: string): BuildArtifact {
        const row = this.db.all<{ document: string }>('SELECT document FROM artifacts WHERE hash=?', [hash])[0];
        if (!row) failCode('SATURN_NOT_FOUND',{resource:'artifact',id:hash},{hash},{status:404});
        const artifact: unknown = JSON.parse(row.document);
        validateBuildArtifact(artifact);
        return artifact;
    }

    published(): string | null {
        return this.meta<string | null>('publishedArtifact', null);
    }

    publish(hash: string, expected: string | null): void {
        this.db.transaction(() => {
            if (this.published() !== expected)
                failCode('SATURN_CONFLICT',{resource:'release',reason:'stateChanged'},{expected,actual:this.published()},{status:409});
            this.artifact(hash);
            this.set('publishedArtifact', hash);
        });
    }

    event(event: Event) {
        this.db.exec('INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?,?)', [event.id, event.runId, event.time, event.type, event.subject, event.actor ?? null, event.detail]);
    }

    notify(id: string, time: number, kind: string, subject: string) {
        this.db.exec('INSERT OR IGNORE INTO outbox(id,time,kind,subject) VALUES(?,?,?,?)', [id, time, kind, subject]);
    }

    save(
        artifact: BuildArtifact,
        state: Checkpoint,
        alarms: Record<string, AlarmState>,
        frame: Frame,
        events: Event[],
        history: HistoryPolicy,
        notifiable: Set<string>,
    ): void {
        const project = artifact.project;
        const policies = this.policies(project);
        const updates = new Map<string, { time: number; value: number | null; quality: string }>();
        this.putArtifact(artifact);
        this.db.transaction(() => {
            this.db.exec(
                'INSERT INTO checkpoints(run_id,artifact_hash,state,alarms) VALUES(?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET state=excluded.state,alarms=excluded.alarms,artifact_hash=excluded.artifact_hash',
                [state.runId, artifact.hash, JSON.stringify(state), JSON.stringify(alarms)],
            );
            this.set('activeRun', state.runId);
            for (const [name, sample] of Object.entries(frame.samples)) {
                const key = state.runId + ':' + name;
                if (!this.last.has(key)) {
                    this.last.set(key, this.db.all<{ time: number; value: number | null; quality: string }>(
                        'SELECT time,value,quality FROM samples WHERE run_id=? AND signal=? ORDER BY time DESC LIMIT 1',
                        [state.runId, name],
                    )[0]);
                }
                const previous = this.last.get(key);
                const policy = policies.get(name) ?? history;
                if (!previous || previous.quality !== sample.quality || (previous.value === null) !== (sample.value === null) ||
                    Math.abs((previous.value ?? 0) - (sample.value ?? 0)) > policy.deadband ||
                    sample.time - previous.time >= policy.maxInterval) {
                    this.db.exec('INSERT OR REPLACE INTO samples VALUES(?,?,?,?,?)', [state.runId, name, sample.time, sample.value, sample.quality]);
                    updates.set(key, sample);
                }
            }
            for (const event of events) {
                this.event(event);
                if (notifiable.has(event.subject) && event.type === 'alarm.raised')
                    this.notify(event.id, Date.now(), 'alarm', event.subject);
            }
        });
        for (const [key, value] of updates) this.last.set(key, value);
    }

    policies(project: Project): Map<string, HistoryPolicy> {
        return new Map([
            ...project.signals.filter(signal => signal.history).map(signal => [signal.id, signal.history!] as const),
            ...project.simulations.flatMap(node => Object.entries(node.history ?? {}).map(([key, value]) => [`${node.id}.${key}`, value] as const)),
        ]);
    }

    pruneProject(project: Project, frame: Frame) {
        const policies = this.policies(project);
        this.db.transaction(() => {
            for (const name of Object.keys(frame.samples)) {
                const before = frame.time - (policies.get(name) ?? project.history).retention;
                this.db.exec(
                    'DELETE FROM samples WHERE run_id=? AND signal=? AND time<? AND time < COALESCE((SELECT MAX(time) FROM samples WHERE run_id=? AND signal=? AND time<?),-1)',
                    [frame.runId, name, before, frame.runId, name, before],
                );
            }
        });
    }

    restore(): { artifact: BuildArtifact; state: Checkpoint; alarms: Record<string, AlarmState> } | null {
        const runId = this.meta<string | null>('activeRun', null);
        if (!runId) return null;
        const row = this.db.all<{ artifact_hash: string; state: string; alarms: string }>(
            'SELECT artifact_hash,state,alarms FROM checkpoints WHERE run_id=?',
            [runId],
        )[0];
        if (!row) return null;
        return { artifact: this.artifact(row.artifact_hash), state: JSON.parse(row.state), alarms: JSON.parse(row.alarms) };
    }

    events(runId: string, limit = 200): Event[] {
        return this.db.all('SELECT id,run_id AS runId,time,type,subject,actor,detail FROM events WHERE run_id=? ORDER BY time DESC,id DESC LIMIT ?', [runId, limit]);
    }

    history(runId: string, signals: string[], from: number, to: number, limit = 20000): ReportData {
        if (signals.length > 64 || to < from || to - from > 7 * 86400000)
            failCode('SATURN_HISTORY_INVALID',{reason:'range'},{signals:signals.length,from,to});
        const samples: ReportData['samples'] = [], segments: ReportData['segments'] = [];
        for (const signal of signals) {
            const previous = this.db.all<{ signal: string; time: number; value: number | null; quality: string }>(
                'SELECT signal,time,value,quality FROM samples WHERE run_id=? AND signal=? AND time<? ORDER BY time DESC LIMIT 1',
                [runId, signal, from],
            );
            const points = this.db.all<ReportData['samples'][number]>(
                'SELECT signal,time,value,quality FROM samples WHERE run_id=? AND signal=? AND time>=? AND time<=? ORDER BY time LIMIT ?',
                [runId, signal, from, to, limit + 1],
            );
            if (samples.length + points.length > limit)
                failCode('SATURN_LIMIT',{resource:'history.rows',reason:'rowBudget'},{limit});
            samples.push(...points);
            const all = [...previous, ...points];
            for (let i = 0; i < all.length; i++) {
                const sample = all[i];
                const start = Math.max(sample.time, from);
                const end = Math.min(all[i + 1]?.time ?? to, to);
                if (end > start) segments.push({ signal, start, end, value: sample.value, quality: sample.quality });
            }
        }
        return { samples, segments };
    }

    prune(runId: string, before: number): void {
        this.db.exec(
            'DELETE FROM samples WHERE run_id=? AND time<? AND (signal,time) NOT IN (SELECT signal,MAX(time) FROM samples WHERE run_id=? AND time<? GROUP BY signal)',
            [runId, before, runId, before],
        );
    }
}
