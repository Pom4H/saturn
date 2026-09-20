import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const exe = resolve(process.argv[2] ?? 'dist/standalone/saturn.exe');
const port = Number(process.env.SATURN_SMOKE_PORT ?? 43176);
const results = resolve(process.env.SATURN_SMOKE_RESULTS ?? 'standalone-test-results');
mkdirSync(results, { recursive: true });
const stdoutPath = join(results, 'stdout.log');
const stderrPath = join(results, 'stderr.log');
const data = join(tmpdir(), `saturn-standalone-${process.pid}-${Date.now()}`);
const project = join(tmpdir(), `saturn-project-${process.pid}-${Date.now()}`);
mkdirSync(data, { recursive: true });
mkdirSync(project, { recursive: true });
const demoFiles = ['views.ts','commissioning.ts','wiring.ts','plant.ts','core.ts','cooling.ts','steam.ts','safety.ts','reports.ts','auxiliary.ts','services.ts','training.ts'];
for (const name of demoFiles)
    copyFileSync(resolve('plant/demo', name), join(project, name));
writeFileSync(join(project, 'scada.project.json'), JSON.stringify({ version: 1, entry: 'plant.ts', files: demoFiles }, null, 2));

const child = spawn(exe, ['open', project], {
    env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        SCADA_USER: 'engineer',
        SCADA_PASSWORD: 'standalone-ci-password',
        SATURN_DATA_DIR: data,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
});
const stdout = [], stderr = [];
child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let healthy = false;
let failure;
try {
    for (let i = 0; i < 80; i++) {
        if (child.exitCode !== null) throw new Error(`saturn executable exited early with code ${child.exitCode}`);
        try {
            const response = await fetch(`http://127.0.0.1:${port}/plant/api/health`, { signal: AbortSignal.timeout(1500) });
            if (response.ok) {
                const body = await response.json();
                if (body.status === 'ok') {
                    healthy = true;
                    break;
                }
            }
        } catch {}
        await sleep(250);
    }
    if (!healthy) throw new Error('Standalone health endpoint did not become ready');
    const database = join(data, 'saturn.sqlite3');
    if (!existsSync(database)) throw new Error(`Standalone database was not created at ${database}`);
    console.log(`Standalone health OK: http://127.0.0.1:${port}/plant/api/health`);
    console.log(`Standalone SQLite OK: ${database}`);
    console.log(`Runtime project load OK: ${project}`);
} catch (error) {
    failure = error;
} finally {
    child.kill();
    await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        sleep(3000).then(() => { if (child.exitCode === null) child.kill('SIGKILL'); }),
    ]);
}

writeFileSync(stdoutPath, Buffer.concat(stdout));
writeFileSync(stderrPath, Buffer.concat(stderr));
for (const [label, path] of [['stdout', stdoutPath], ['stderr', stderrPath]]) {
    if (existsSync(path)) {
        const content = readFileSync(path, 'utf8').trim();
        if (content) console.log(`--- ${label} ---\n${content}`);
    }
}
if (failure) throw failure;
