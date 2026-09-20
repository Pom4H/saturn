import { dirname, join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { startPlantHttpServer } from '../plant/http-server';
import { LocalRepository, Store } from '../plant/store';
import { BunSql } from './bun-sql';
import { runStandaloneReport } from './reports';
import { loadProjectDirectory } from './project-loader';
import { WorkspaceRegistry } from './workspace';
import { WorkspaceRepository } from './workspace-repository';
import { applyStagedUpdate, runUpdateCommand } from './update';
import { runExtensionCommand } from './extensions';

declare const SATURN_VERSION: string;
declare const SATURN_DEMO_FILES: Record<string, string>;
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

async function selfHealthcheck(): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), 'saturn-health-'));
    let app: Awaited<ReturnType<typeof startPlantHttpServer>> | undefined;
    try {
        const database = new BunSql(resolve(directory, 'health.sqlite3'));
        const store = new Store(database);
        const repository = new LocalRepository(store, () => `health:${crypto.randomUUID()}`);
        app = await startPlantHttpServer({
            port: 0,
            host: '127.0.0.1',
            password: 'saturn-healthcheck-password',
            root: resolve(import.meta.dir, 'dist/plant'),
            embeddedStatic: true,
            autoTick: false,
            uiMode: 'runtime',
            database,
            projectRepository: repository,
            reportRunner: runStandaloneReport,
            seed: SATURN_DEMO_FILES,
        });
        const response = await fetch(`${app.origin}/plant/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (!response.ok || (await response.json() as any).status !== 'ok')
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

if (args[0] === '__apply-update') {
    await applyStagedUpdate(args.slice(1));
    process.exit(0);
}
if (args[0] === '__healthcheck') {
    await selfHealthcheck();
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
    });
    process.exit(0);
}
if (args[0] === 'extension' || args[0] === 'extensions') {
    await runExtensionCommand(args.slice(1), appData);
    process.exit(0);
}

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
    files = loaded.files;
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
const repositoryStore = new Store(database);
const projectRepository = projectDirectory
    ? await new WorkspaceRepository(repositoryStore, projectDirectory).initialize(files)
    : new LocalRepository(repositoryStore, () => `standalone:${crypto.randomUUID()}`);

const app = await startPlantHttpServer({
    port: Number(process.env.PORT ?? 4176),
    host: process.env.HOST ?? '127.0.0.1',
    publicUrl: process.env.SCADA_PUBLIC_URL,
    user: process.env.SCADA_USER,
    password: process.env.SCADA_PASSWORD,
    root: resolve(import.meta.dir, 'dist/plant'),
    embeddedStatic: true,
    autoTick: true,
    pushSubject: process.env.SCADA_PUSH_SUBJECT,
    uiMode: kiosk ? 'kiosk' : command === 'run' ? 'runtime' : 'ide',
    database,
    projectRepository,
    reportRunner: runStandaloneReport,
    seed: files,
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
