import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import type { ReportTask, ReportArtifact } from '../types';

interface BunSubprocess {
    send(message: unknown): void;
    kill(signal?: string | number): void;
}
interface BunSpawnRuntime {
    spawn(options: {
        cmd: string[];
        stdin: 'ignore';
        stdout: 'ignore';
        stderr: 'ignore';
        timeout: number;
        killSignal: string;
        serialization: 'advanced';
        env: Record<string, string | undefined>;
        cgroup?: string;
        ipc(message: unknown): void;
        onExit(_subprocess: unknown, exitCode: number | null, signalCode: number | null, error?: unknown): void;
    }): BunSubprocess;
}
const bunRuntime = (() => {
    const runtime = (globalThis as typeof globalThis & { Bun?: BunSpawnRuntime }).Bun;
    if (!runtime) throw new Error('Bun report runner requires Bun');
    return runtime;
})();

/** Disposable Bun process: native SQLite work can be killed at the process boundary. */
export function runReport(task: ReportTask, timeoutMs = 5000): Promise<ReportArtifact> {
    return new Promise((resolve, reject) => {
        let finished = false;
        let child: BunSubprocess | undefined;
        const done = (error: unknown, value?: ReportArtifact) => {
            if (finished) return;
            finished = true;
            try { child?.kill('SIGKILL'); } catch { /* already exited */ }
            error ? reject(error) : resolve(value!);
        };
        const siblingWorker = fileURLToPath(new URL('./report-worker.mjs', import.meta.url));
        const worker = existsSync(siblingWorker) ? siblingWorker : resolvePath('.plant/report-worker.mjs');
        child = bunRuntime.spawn({
            cmd: [process.execPath, worker],
            stdin: 'ignore',
            stdout: 'ignore',
            stderr: 'ignore',
            timeout: timeoutMs,
            killSignal: 'SIGKILL',
            serialization: 'advanced',
            env: { TZ: 'UTC' },
            ...(process.platform === 'linux' && process.env.SCADA_REPORT_CGROUP ? { cgroup: process.env.SCADA_REPORT_CGROUP } : {}),
            ipc(message: unknown) {
                const value = message as { error?: string; result?: ReportArtifact };
                done(value.error ? new Error(value.error) : null, value.result);
            },
            onExit(_subprocess, exitCode, signalCode, error) {
                if (!finished) done(error ?? new Error(`Report process exited (${exitCode ?? signalCode ?? 'unknown'})`));
            },
        });
        child.send(task);
    });
}
