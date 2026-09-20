import { resolve } from 'node:path';
import { NodeSql } from './adapters/node-sql';
import { GitRepository } from './adapters/git';
import { runReport } from './adapters/node-reports';
import { demoFiles } from './demo/files';
import { startPlantHttpServer } from './http-server';

export async function startPlantServer(options: {
    port?: number;
    host?: string;
    data?: string;
    repository?: string;
    publicUrl?: string;
    user?: string;
    password?: string;
    root?: string;
    autoTick?: boolean;
    pushSubject?: string;
} = {}) {
    const database = new NodeSql(options.data ?? resolve('data-plant/plant.sqlite3'));
    const projectRepository = await new GitRepository(options.repository ?? resolve('data-plant/project.git')).initialize();
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
        projectRepository,
        reportRunner: runReport,
        seed: demoFiles,
    });
}

export { startPlantHttpServer } from './http-server';
