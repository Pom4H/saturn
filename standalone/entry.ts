import { dirname, join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { startPlantHttpServer } from '../plant/http-server';
import { BunSql } from './bun-sql';
import { runStandaloneReport } from './reports';
import { loadProjectDirectory } from './project-loader';
import { WorkspaceRegistry } from './workspace';
import { applyStagedUpdate, checkApplicationUpdate, installApplicationUpdate, runUpdateCommand, type UpdateChannel } from './update';
import { addRegistryItem, runRegistryCommand } from './registry';
import { runIdeCommand } from './ide';
import { buildArtifact } from '../plant/artifact';
import { WorkspaceHost } from './workspace-host';
import { createSaturnProject } from './scaffold';

declare const SATURN_VERSION: string;
declare const SATURN_DEMO_FILES: Record<string, string>;
declare const SATURN_WEB_ASSETS: Record<string, string>;
declare const SATURN_UPDATE_PUBLIC_KEY: string;
declare const SATURN_UPDATE_MANIFEST_URL: string;

if (typeof process.umask === 'function') process.umask(0o077);

function applicationDataRoot(): string {
    if (process.platform === 'win32')
        return resolve(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Saturn');
    if (process.platform === 'darwin')
        return resolve(homedir(), 'Library', 'Application Support', 'Saturn');
    return resolve(process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'saturn');
}

async function selfHealthcheck(expectedVersion?: string): Promise<void> {
    if (expectedVersion && SATURN_VERSION !== expectedVersion)
        throw new Error(`Saturn binary version ${SATURN_VERSION} does not match expected update version ${expectedVersion}`);
    const directory = await mkdtemp(join(tmpdir(), 'saturn-health-'));
    let app: Awaited<ReturnType<typeof startPlantHttpServer>> | undefined;
    try {
        const database = new BunSql(resolve(directory, 'health.sqlite3'));
        const seed = await buildArtifact(SATURN_DEMO_FILES, { packageName: '@saturn/demo' });
        app = await startPlantHttpServer({
            port: 0,
            host: '127.0.0.1',
            password: 'saturn-healthcheck-password',
            root: resolve(import.meta.dir, 'dist/plant'),
            embeddedStatic: standaloneExecutable,
            staticReader: standaloneExecutable ? readEmbeddedPlantAsset : undefined,
            autoTick: false,
            uiMode: 'runtime',
            database,
            reportRunner: runStandaloneReport,
            seed,
        });
        const response = await fetch(`${app.origin}/plant/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        const health: unknown = await response.json();
        if (!response.ok || !health || typeof health !== 'object' || !('status' in health) || (health as {status?:unknown}).status !== 'ok')
            throw new Error('Saturn internal health check failed');
    }
    finally {
        await app?.close().catch(() => {});
        await rm(directory, { recursive: true, force: true });
    }
}

let args = process.argv.slice(1);
const entryArg = args[0]?.replaceAll('\\', '/') ?? '';
const standaloneExecutable = entryArg.includes('/~BUN/');
if (entryArg.endsWith('/standalone/entry.ts') || standaloneExecutable)
    args = args.slice(1);

const appData = applicationDataRoot();

const decodedWebAssets = new Map<string, Uint8Array>();
async function readEmbeddedPlantAsset(relativePath: string): Promise<Uint8Array> {
    const clean = relativePath.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\//, '');
    const existing = decodedWebAssets.get(clean);
    if (existing)
        return existing;
    const encoded = SATURN_WEB_ASSETS[clean];
    if (!encoded)
        throw new Error(`Embedded Saturn asset not found: ${clean}`);
    const bytes = new Uint8Array(Buffer.from(encoded, 'base64'));
    decodedWebAssets.set(clean, bytes);
    return bytes;
}



if (args[0] === '__apply-update') {
    await applyStagedUpdate(args.slice(1));
    process.exit(0);
}
if (args[0] === '__version') {
    console.log(SATURN_VERSION);
    process.exit(0);
}
if (args[0] === '__healthcheck') {
    const expectedIndex = args.indexOf('--expect-version');
    await selfHealthcheck(expectedIndex >= 0 ? args[expectedIndex + 1] : undefined);
    process.exit(0);
}
if (args[0] === 'update') {
    await runUpdateCommand(args.slice(1), {
        currentVersion: SATURN_VERSION,
        publicKeyPem: SATURN_UPDATE_PUBLIC_KEY,
        defaultManifestUrl: SATURN_UPDATE_MANIFEST_URL,
        appData,
        executable: process.execPath,
        standaloneExecutable,
        restartArgs: [],
    });
    process.exit(0);
}
if (args[0] === 'new') {
    const directory = args[1];
    if (!directory) throw new Error('Usage: saturn new <directory>');
    const created = await createSaturnProject(directory);
    const host = new WorkspaceHost(created);
    const artifact = await host.build();
    console.log(`Created Saturn project: ${created}`);
    console.log(`Build: ${artifact.hash}`);
    process.exit(0);
}
if (args[0] === 'check') {
    const directory = args[1] ?? process.cwd();
    const host = new WorkspaceHost(directory);
    const artifact = await host.build();
    console.log(`OK ${artifact.project.title} · ${artifact.hash}`);
    process.exit(0);
}
if (args[0] === 'registry') {
    await runRegistryCommand(args.slice(1));
    process.exit(0);
}
if (args[0] === 'add') {
    const name = args[1];
    if (!name) throw new Error('Usage: saturn add <registry-item> [--project PATH]');
    const projectIndex = args.indexOf('--project');
    const project = projectIndex >= 0 ? args[projectIndex + 1] : process.cwd();
    console.log(JSON.stringify(await addRegistryItem(project, name), null, 2));
    process.exit(0);
}
if (args[0] === 'ide') {
    await runIdeCommand(args.slice(1));
    process.exit(0);
}

const runtimeInvocationArgs = args.slice();
const command = args[0] === 'run' ? 'run' : args[0] === 'open' ? 'open' : 'open';
if (args[0] === 'run' || args[0] === 'open')
    args = args.slice(1);
const kiosk = args.includes('--kiosk');
const projectArgument = args.find(arg => !arg.startsWith('--')) ?? process.env.SATURN_PROJECT;
const registry = new WorkspaceRegistry(resolve(appData, 'workspace.json'));

let files = SATURN_DEMO_FILES;
let projectDirectory: string | null = null;
let projectId = 'demo';
let projectTitle = 'Saturn demo';

if (projectArgument) {
    const loaded = await loadProjectDirectory(projectArgument);
    files = loaded.sources;
    projectDirectory = loaded.directory;
    projectId = loaded.id;
    projectTitle = loaded.title;
    await registry.touch({ path: loaded.directory, id: loaded.id, title: loaded.title });
}

const key = projectDirectory
    ? createHash('sha256').update(projectDirectory).digest('hex').slice(0, 16)
    : 'demo';
const dataDirectory = resolve(process.env.SATURN_DATA_DIR ?? resolve(appData, 'projects', key));
mkdirSync(dataDirectory, { recursive: true });

const database = new BunSql(resolve(dataDirectory, 'saturn.sqlite3'));
const workspaceHost = projectDirectory ? new WorkspaceHost(projectDirectory) : null;
const seedArtifact = workspaceHost
    ? await workspaceHost.build()
    : await buildArtifact(files, { packageName: '@saturn/demo' });

const updateChannel = ((process.env.SATURN_UPDATE_CHANNEL ?? 'stable') as UpdateChannel);
const updateContext = {
    currentVersion: SATURN_VERSION,
    publicKeyPem: SATURN_UPDATE_PUBLIC_KEY,
    defaultManifestUrl: SATURN_UPDATE_MANIFEST_URL,
    appData,
    executable: process.execPath,
    standaloneExecutable,
    restartArgs: runtimeInvocationArgs,
};
let app: Awaited<ReturnType<typeof startPlantHttpServer>>;
app = await startPlantHttpServer({
    port: Number(process.env.PORT ?? 4176),
    host: process.env.HOST ?? '127.0.0.1',
    publicUrl: process.env.SCADA_PUBLIC_URL,
    user: process.env.SCADA_USER,
    password: process.env.SCADA_PASSWORD,
    root: resolve(import.meta.dir, 'dist/plant'),
    embeddedStatic: standaloneExecutable,
    staticReader: standaloneExecutable ? readEmbeddedPlantAsset : undefined,
    autoTick: true,
    pushSubject: process.env.SCADA_PUSH_SUBJECT,
    uiMode: kiosk ? 'kiosk' : command === 'run' ? 'runtime' : 'ide',
    application: {
        version: SATURN_VERSION,
        update: {
            check: () => checkApplicationUpdate(updateContext, updateChannel),
            install: async () => {
                const result = await installApplicationUpdate(updateContext, updateChannel);
                setTimeout(() => void app.close().finally(() => process.exit(0)), 500);
                return result;
            },
        },
    },
    database,
    ...(workspaceHost ? { workspace: workspaceHost } : {}),
    reportRunner: runStandaloneReport,
    seed: seedArtifact,
});

console.log(`Saturn ${SATURN_VERSION} · ${kiosk ? 'kiosk' : command}`);
console.log(`Project: ${projectTitle}${projectDirectory ? ` · ${projectDirectory}` : ' · built-in demo'}`);
console.log(`SCADA: ${app.origin}/plant/app/`);
console.log(`Demo:  ${app.origin}/plant/demo/`);
console.log(`Data:  ${dataDirectory}`);
if (!projectDirectory) {
    const recent = (await registry.read()).recent.slice(0, 5);
    if (recent.length) {
        console.log('Recent projects:');
        for (const item of recent)
            console.log(`  ${item.title} · ${item.path}`);
    }
}
if (app.initialPassword)
    console.log(`Initial engineer password (store securely): ${app.initialPassword}`);

let closing = false;
const close = async () => {
    if (closing) return;
    closing = true;
    await app.close();
    process.exit(0);
};
for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => void close());
