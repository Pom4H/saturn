import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { startPlantHttpServer } from '../plant/http-server';
import { LocalRepository, Store } from '../plant/store';
import { BunSql } from './bun-sql';
import { runStandaloneReport } from './reports';

declare const SATURN_PACKED_PROJECT: Record<string, string>;
declare const SATURN_VERSION: string;

if (typeof process.umask === 'function') process.umask(0o077);

const dataDirectory = resolve(process.env.SATURN_DATA_DIR ?? resolve(dirname(process.execPath), 'saturn-data'));
mkdirSync(dataDirectory, { recursive: true });
const database = new BunSql(resolve(dataDirectory, 'saturn.sqlite3'));
const repositoryStore = new Store(database);
const projectRepository = new LocalRepository(repositoryStore, () => `standalone:${crypto.randomUUID()}`);

const app = await startPlantHttpServer({
    port: Number(process.env.PORT ?? 4176),
    host: process.env.HOST ?? '127.0.0.1',
    publicUrl: process.env.SCADA_PUBLIC_URL,
    user: process.env.SCADA_USER,
    password: process.env.SCADA_PASSWORD,
    root: resolve(import.meta.dir, 'dist/plant'),
    autoTick: true,
    pushSubject: process.env.SCADA_PUSH_SUBJECT,
    database,
    projectRepository,
    reportRunner: runStandaloneReport,
    seed: SATURN_PACKED_PROJECT,
});

console.log(`Saturn ${SATURN_VERSION}`);
console.log(`SCADA: ${app.origin}/plant/app/`);
console.log(`Demo:  ${app.origin}/plant/demo/`);
console.log(`Data:  ${dataDirectory}`);
if (app.initialPassword) console.log(`Initial engineer password (store securely): ${app.initialPassword}`);

let closing = false;
const close = async () => {
    if (closing) return;
    closing = true;
    await app.close();
    process.exit(0);
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void close());
