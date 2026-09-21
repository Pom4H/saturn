import { resolve } from 'node:path';
import { NodeSql } from './adapters/node-sql';
import { runReport } from './adapters/node-reports';
import { demoFiles } from './demo/files';
import { buildArtifact, type BuildArtifact } from './artifact';
import { startPlantHttpServer } from './http-server';

export async function startPlantServer(options: {
    port?: number;
    host?: string;
    data?: string;
    publicUrl?: string;
    user?: string;
    password?: string;
    root?: string;
    autoTick?: boolean;
    pushSubject?: string;
    artifact?: BuildArtifact;
} = {}) {
    const database = new NodeSql(options.data ?? resolve('data-plant/runtime.sqlite3'));
    const seed = options.artifact ?? await buildArtifact(demoFiles, { packageName: '@saturn/demo' });
    return startPlantHttpServer({
        port: options.port,
        host: options.host,
        publicUrl: options.publicUrl,
        user: options.user,
        password: options.password,
        root: options.root,
        autoTick: options.autoTick,
        pushSubject: options.pushSubject,
        database,
        reportRunner: runReport,
        seed,
    });
}

export { startPlantHttpServer } from './http-server';
