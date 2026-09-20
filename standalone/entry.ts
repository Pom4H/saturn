import { dirname, join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { startPlantHttpServer } from '../plant/http-server';
import { LocalRepository, Store } from '../plant/store';
import { BunSql } from './bun-sql';
import { runStandaloneReport } from './reports';
import { loadProjectDirectory } from './project-loader';
import { WorkspaceRegistry } from './workspace';
import { WorkspaceRepository } from './workspace-repository';

declare const SATURN_VERSION: string;
declare const SATURN_DEMO_FILES: Record<string, string>;

if (typeof process.umask === 'function') process.umask(0o077);

function applicationDataRoot(): string {
    if (process.platform === 'win32')
        return resolve(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Saturn');
    if (process.platform === 'darwin')
        return resolve(homedir(), 'Library', 'Application Support', 'Saturn');
    return resolve(process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'saturn');
}

let args = process.argv.slice(1);
const entryArg = args[0]?.replaceAll('\\', '/') ?? '';
if (entryArg.endsWith('/standalone/entry.ts') || entryArg.includes('/~BUN/'))
    args = args.slice(1);

const command = args[0] === 'run' ? 'run' : args[0] === 'open' ? 'open' : 'open';
if (args[0] === 'run' || args[0] === 'open')
    args = args.slice(1);
const kiosk = args.includes('--kiosk');
const projectArgument = args.find(arg => !arg.startsWith('--')) ?? process.env.SATURN_PROJECT;
const appData = applicationDataRoot();
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
