import { pathToFileURL } from 'node:url';
import { startPlantServer } from './server';
import { driverModulesFromEnv } from './server/drivers';
import type { WorkerJobKind } from './types';

function workerTokens():Record<string,WorkerJobKind[]>{
    const raw=process.env.SATURN_WORKER_TOKENS;
    if(raw){
        const parsed=JSON.parse(raw) as Record<string,WorkerJobKind[]>;
        if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('SATURN_WORKER_TOKENS must be a JSON object');
        return parsed;
    }
    const legacy=process.env.SATURN_WORKER_TOKEN;
    return legacy?{[legacy]:['report','sql','wasm']}:{};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.umask(0o077);
    const app = await startPlantServer({
        port:Number(process.env.PORT??4176),
        host:process.env.HOST??'127.0.0.1',
        data:process.env.SATURN_DATABASE??process.env.SCADA_DATABASE,
        repository:process.env.SATURN_PROJECT_REPO??process.env.SCADA_PROJECT_REPO,
        publicUrl:process.env.SATURN_PUBLIC_URL??process.env.SCADA_PUBLIC_URL,
        user:process.env.SATURN_USER??process.env.SCADA_USER,
        password:process.env.SATURN_PASSWORD??process.env.SCADA_PASSWORD,
        pushSubject:process.env.SATURN_PUSH_SUBJECT??process.env.SCADA_PUSH_SUBJECT,
        externalWorkers:(process.env.SATURN_WORKERS??'inline')==='external',
        workerTokens:workerTokens(),
        connectionsFile:process.env.SATURN_CONNECTIONS_FILE,
        driverModules:driverModulesFromEnv(),
    });
    const runtime=(process.versions as any).bun?`Bun ${(process.versions as any).bun}`:`Node.js ${process.version}`;
    console.log(`Saturn (${runtime}): ${app.origin}/plant/app/`);
    console.log(`Browser demo only: ${app.origin}/plant/demo/`);
    if(app.initialPassword)console.log(`Initial engineer password (store securely): ${app.initialPassword}`);
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void app.close().then(()=>process.exit(0)));
}
