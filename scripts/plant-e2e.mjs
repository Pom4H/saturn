/** Isolated local integration test. No account, existing database or external service required. */
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
const raw = { name: 'raw', setup(b) { b.onResolve({ filter: /\?raw$/ }, a => ({ path: new URL(a.path.slice(0, -4), pathToFileURL(a.resolveDir + '/')).pathname, namespace: 'raw' })); b.onLoad({ filter: /.*/, namespace: 'raw' }, async (a) => ({ contents: await readFile(a.path, 'utf8'), loader: 'text' })); } };
await build({ entryPoints: ['plant/server.ts'], outfile: '.plant/test-server.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external', plugins: [raw] });
const { startPlantServer } = await import(pathToFileURL(join(process.cwd(), '.plant/test-server.mjs')));
const directory = await mkdtemp(join(tmpdir(), 'scada-browser-'));
const password = randomBytes(24).toString('base64url');
let server;
try {
    server = await startPlantServer({ port: 0, data: join(directory, 'db.sqlite'), repository: join(directory, 'project.git'), password });
    const code = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['scripts/plant-browser-test.mjs'], { stdio: 'inherit', env: { ...process.env, SCADA_USER: 'engineer', SCADA_PASSWORD: password, PWA_URL: server.origin + '/plant/' } });
        child.once('error', reject);
        child.once('exit', code => resolve(code ?? 1));
    });
    process.exitCode = code;
}
finally {
    await server?.close();
    await rm(directory, { recursive: true, force: true });
}
