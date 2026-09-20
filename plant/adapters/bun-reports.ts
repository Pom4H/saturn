import { fileURLToPath } from 'node:url';
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
        ipc(message: unknown): void;
        onExit(_subprocess: unknown, exitCode: number | null, signalCode: number | null, error?: unknown): void;
    }): BunSubprocess;
}
const bunRuntime = (globalThis as typeof globalThis & { Bun?: BunSpawnRuntime }).Bun;
if (!bunRuntime) throw new Error('Bun report runner requires Bun');

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
        child = bunRuntime.spawn({
            cmd: [process.execPath, fileURLToPath(new URL('./report-worker.mjs', import.meta.url))],
            stdin: 'ignore',
            stdout: 'ignore',
            stderr: 'ignore',
            timeout: timeoutMs,
            killSignal: 'SIGKILL',
            serialization: 'advanced',
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
