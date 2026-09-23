import { fork } from 'node:child_process';
import type { ReportTask, ReportArtifact } from '../types';
/** A process, not a thread: SIGKILL can interrupt a native SQLite query as well as JS. */
export function runReport(task: ReportTask, timeoutMs = 5000): Promise<ReportArtifact> {
    return new Promise((resolve, reject) => {
        const child = fork(new URL('./node-report-worker.mjs', import.meta.url), [], {
            execArgv: ['--experimental-sqlite', '--max-old-space-size=96'],
            stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
            serialization: 'advanced',
        });
        let finished = false;
        const done = (error: unknown, value?: ReportArtifact) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            child.kill('SIGKILL');
            error ? reject(error) : resolve(value!);
        };
        const timer = setTimeout(() => done(new Error('Report exceeded its execution budget')), timeoutMs);
        child.on('message', (message: {error?: string; result?: ReportArtifact}) => {
            done(message.error ? new Error(message.error) : null, message.result);
        });
        child.on('error', done);
        child.on('exit', code => {
            if (!finished) done(new Error(`Report process exited (${code})`));
        });
        child.send(task, error => { if (error) done(error); });
    });
}
