import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const exe = resolve(process.argv[2] ?? 'dist/standalone/saturn.exe');
const nextExe = process.argv[3] ? resolve(process.argv[3]) : null;
const updatePrivateKey = process.argv[4] ? resolve(process.argv[4]) : null;
const port = Number(process.env.SATURN_SMOKE_PORT ?? 43176);
const results = resolve(process.env.SATURN_SMOKE_RESULTS ?? 'standalone-test-results');
mkdirSync(results, { recursive: true });
const stdoutPath = join(results, 'stdout.log');
const stderrPath = join(results, 'stderr.log');
const data = join(tmpdir(), `saturn-standalone-${process.pid}-${Date.now()}`);
const project = join(tmpdir(), `saturn-project-${process.pid}-${Date.now()}`);
const localAppData = join(tmpdir(), `saturn-appdata-${process.pid}-${Date.now()}`);
mkdirSync(data, { recursive: true });
mkdirSync(project, { recursive: true });
mkdirSync(localAppData, { recursive: true });

const demoFiles = ['views.ts','commissioning.ts','wiring.ts','plant.ts','core.ts','cooling.ts','steam.ts','safety.ts','reports.ts','auxiliary.ts','services.ts','training.ts'];
for (const name of demoFiles)
    copyFileSync(resolve('plant/demo', name), join(project, name));
writeFileSync(join(project, 'scada.project.json'), JSON.stringify({ version: 1, entry: 'plant.ts', files: demoFiles }, null, 2));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const hashFile = path => createHash('sha256').update(readFileSync(path)).digest('hex');

function run(file, args, env = {}) {
    return new Promise((resolveRun, reject) => {
        const child = spawn(file, args, {
            env: { ...process.env, LOCALAPPDATA: localAppData, ...env },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            shell: false,
        });
        const stdout = [], stderr = [];
        child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
        child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
        child.once('error', reject);
        child.once('exit', code => resolveRun({ code: code ?? 1, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }));
    });
}

const child = spawn(exe, ['open', project], {
    env: {
        ...process.env,
        LOCALAPPDATA: localAppData,
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
        new Promise(resolveExit => child.once('exit', resolveExit)),
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

function tarFile(name, content) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const header = Buffer.alloc(512);
    Buffer.from(name).copy(header, 0, 0, Math.min(Buffer.byteLength(name), 100));
    Buffer.from(data.length.toString(8).padStart(11, '0') + '\0').copy(header, 124);
    header[156] = '0'.charCodeAt(0);
    const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
    return Buffer.concat([header, data, padding]);
}

let registryOrigin = '';
const extensionPackage = {
    name: '@test/elements',
    version: '1.0.0',
    saturn: {
        api: 1,
        entry: 'dist/index.js',
        capabilities: ['elements'],
        elements: [{ type: 'test.motor', title: 'Test Motor', tag: 'test-motor' }],
    },
};
const extensionTar = gzipSync(Buffer.concat([
    tarFile('package/package.json', JSON.stringify(extensionPackage)),
    tarFile('package/dist/index.js', 'customElements.define("test-motor", class extends HTMLElement {}); export const installed = true;'),
    Buffer.alloc(1024),
]));
const extensionIntegrity = 'sha512-' + createHash('sha512').update(extensionTar).digest('base64');
const registry = createServer((req, res) => {
    if (req.url === '/pack.tgz') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(extensionTar);
        return;
    }
    const version = { ...extensionPackage, dist: { tarball: registryOrigin + '/pack.tgz', integrity: extensionIntegrity } };
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        name: extensionPackage.name,
        'dist-tags': { latest: extensionPackage.version },
        versions: { [extensionPackage.version]: version },
    }));
});
await new Promise((resolveListen, reject) => {
    registry.once('error', reject);
    registry.listen(0, '127.0.0.1', () => { registry.off('error', reject); resolveListen(); });
});
registryOrigin = `http://127.0.0.1:${registry.address().port}`;
try {
    const installed = await run(exe, ['extension', 'add', '@test/elements@1.0.0'], { SATURN_NPM_REGISTRY: registryOrigin + '/' });
    if (installed.code !== 0) throw new Error(`Extension install failed: ${installed.stderr || installed.stdout}`);
    const listed = await run(exe, ['extension', 'list']);
    if (listed.code !== 0 || !listed.stdout.includes('@test/elements@1.0.0'))
        throw new Error(`Installed extension was not listed: ${listed.stderr || listed.stdout}`);
    console.log('Extension registry install OK: @test/elements@1.0.0');

    const extensionPort = port + 1;
    const extensionData = join(tmpdir(), `saturn-extension-api-${process.pid}-${Date.now()}`);
    mkdirSync(extensionData, { recursive: true });
    const appChild = spawn(exe, ['open', project], {
        env: {
            ...process.env,
            LOCALAPPDATA: localAppData,
            PORT: String(extensionPort),
            HOST: '127.0.0.1',
            SCADA_USER: 'engineer',
            SCADA_PASSWORD: 'standalone-ci-password',
            SATURN_DATA_DIR: extensionData,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
    const appStdout = [], appStderr = [];
    appChild.stdout.on('data', chunk => appStdout.push(Buffer.from(chunk)));
    appChild.stderr.on('data', chunk => appStderr.push(Buffer.from(chunk)));
    try {
        let ready = false;
        for (let i = 0; i < 80; i++) {
            if (appChild.exitCode !== null)
                throw new Error(`Extension API Saturn exited early: ${Buffer.concat(appStderr).toString('utf8')}`);
            try {
                const response = await fetch(`http://127.0.0.1:${extensionPort}/plant/api/health`, { signal: AbortSignal.timeout(1000) });
                if (response.ok) { ready = true; break; }
            } catch {}
            await sleep(200);
        }
        if (!ready)
            throw new Error('Extension API Saturn did not become ready');
        const origin = `http://127.0.0.1:${extensionPort}`;
        const login = await fetch(origin + '/plant/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: origin },
            body: JSON.stringify({ user: 'engineer', password: 'standalone-ci-password' }),
        });
        if (!login.ok)
            throw new Error(`Extension API login failed: ${login.status}`);
        const cookie = login.headers.get('set-cookie')?.split(';')[0];
        if (!cookie)
            throw new Error('Extension API login returned no cookie');
        const applicationResponse = await fetch(origin + '/plant/api/application', { headers: { Cookie: cookie } });
        const application = await applicationResponse.json();
        const extension = application.extensions?.find(item => item.name === '@test/elements');
        if (!applicationResponse.ok || !extension?.entryUrl)
            throw new Error('Installed extension is missing from authenticated application API');
        const asset = await fetch(origin + extension.entryUrl, { headers: { Cookie: cookie } });
        const source = await asset.text();
        if (!asset.ok || !source.includes('customElements.define("test-motor"'))
            throw new Error('Installed extension browser entry was not served');
        const page = await fetch(origin + '/plant/app/', { headers: { Cookie: cookie } });
        const pageText = await page.text();
        if (!page.ok || !pageText.includes('data-tab="extensions"'))
            throw new Error(`Engineering UI does not expose Extensions panel (HTTP ${page.status}): ${pageText.slice(0, 240)}`);
        console.log('Extension application API + browser entry OK');
    } finally {
        appChild.kill();
        await Promise.race([
            new Promise(resolveExit => appChild.once('exit', resolveExit)),
            sleep(3000).then(() => { if (appChild.exitCode === null) appChild.kill('SIGKILL'); }),
        ]);
    }

    const removed = await run(exe, ['extension', 'remove', '@test/elements']);
    if (removed.code !== 0) throw new Error(`Extension remove failed: ${removed.stderr || removed.stdout}`);
} finally {
    await new Promise(resolveClose => registry.close(resolveClose));
}

if (nextExe && updatePrivateKey) {
    const nextBytes = readFileSync(nextExe);
    const nextHash = createHash('sha256').update(nextBytes).digest('hex');
    const originalHash = hashFile(exe);
    const privateKey = readFileSync(updatePrivateKey, 'utf8');
    let updateOrigin = '';
    const artifactUrl = () => updateOrigin + '/saturn-next.exe';
    const manifest = {
        schema: 1,
        version: '0.1.1',
        channel: 'stable',
        publishedAt: new Date().toISOString(),
        artifacts: {},
    };
    const artifact = {
        url: '',
        sha256: nextHash,
        signature: '',
        size: nextBytes.length,
    };
    manifest.artifacts['windows-x64'] = artifact;

    const updateServer = createServer((req, res) => {
        if (req.url === '/saturn-next.exe') {
            res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': nextBytes.length }).end(nextBytes);
            return;
        }
        if (req.url === '/manifest.json') {
            res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(manifest));
            return;
        }
        res.writeHead(404).end();
    });
    await new Promise((resolveListen, reject) => {
        updateServer.once('error', reject);
        updateServer.listen(0, '127.0.0.1', () => { updateServer.off('error', reject); resolveListen(); });
    });
    updateOrigin = `http://127.0.0.1:${updateServer.address().port}`;
    artifact.url = artifactUrl();
    const payload = Buffer.from(JSON.stringify({
        schema: 1,
        version: manifest.version,
        channel: manifest.channel,
        target: 'windows-x64',
        url: artifact.url,
        sha256: artifact.sha256,
    }), 'utf8');
    artifact.signature = sign(null, payload, privateKey).toString('base64url');

    try {
        const update = await run(exe, ['update', '--manifest', updateOrigin + '/manifest.json'], { SATURN_UPDATE_NO_RELAUNCH: '1' });
        if (update.code !== 0) throw new Error(`Update command failed: ${update.stderr || update.stdout}`);
        const staged = join(localAppData, 'Saturn', 'updates', '0.1.1', 'saturn-0.1.1-windows-x64.exe');
        let applied = false;
        for (let i = 0; i < 300; i++) {
            if (existsSync(exe) && hashFile(exe) === nextHash && !existsSync(staged)) {
                applied = true;
                break;
            }
            await sleep(100);
        }
        if (!applied) throw new Error('Signed update was not atomically applied and health-gated');
        const version = await run(exe, ['__version']);
        if (version.code !== 0 || version.stdout.trim() !== '0.1.1')
            throw new Error(`Updated binary version mismatch: ${version.stderr || version.stdout}`);
        const backup = resolve(dirname(exe), 'saturn.previous.exe');
        if (!existsSync(backup) || hashFile(backup) !== originalHash)
            throw new Error('Update backup was not preserved');
        console.log('Signed self-update OK: 0.1.0 → 0.1.1 with health gate');
        copyFileSync(backup, exe);
        rmSync(backup, { force: true });
        const restored = await run(exe, ['__version']);
        if (restored.code !== 0 || restored.stdout.trim() !== '0.1.0')
            throw new Error('Original Saturn executable was not restored after update smoke');
    } finally {
        await new Promise(resolveClose => updateServer.close(resolveClose));
        rmSync(nextExe, { force: true });
    }
}
