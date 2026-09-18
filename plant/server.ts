import { createServer, type IncomingMessage } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { NodeSql } from './adapters/node-sql';
import { GitRepository } from './adapters/git';
import { Auth } from './adapters/auth';
import { Push } from './adapters/push';
import { runReport } from './adapters/node-reports';
import { Store } from './store';
import { Service } from './service';
import { AppError, type WorkerJobKind } from './types';
import { authorize, capabilities } from './server/policy';
import { DriverRegistry, loadConnections, loadDriverModules } from './server/drivers';
import { IndustrialGateway } from './server/gateway';
import { installBuiltInServerDrivers } from './server/builtin-drivers';
import { demoFiles } from './demo/files';
const prefix = '/plant';
async function body(req: IncomingMessage): Promise<any> { if (!req.headers['content-type']?.startsWith('application/json'))
    throw new AppError('JSON body required', 415); let size = 0; const chunks: Buffer[] = []; for await (const chunk of req) {
    size += chunk.length;
    if (size > 2100000)
        throw new AppError('Request too large', 413);
    chunks.push(chunk);
} try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
catch {
    throw new AppError('Invalid JSON');
} }
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
    externalWorkers?: boolean;
    workerTokens?: Record<string,WorkerJobKind[]>;
    connectionsFile?: string;
    driverModules?: string[];
} = {}) {
    const registry=new DriverRegistry();
    installBuiltInServerDrivers(registry);
    await loadDriverModules(registry,options.driverModules??[]);
    const gateway=new IndustrialGateway(registry,await loadConnections(options.connectionsFile));
    const store = new Store(new NodeSql(options.data ?? resolve('data-plant/plant.sqlite3')));
    const repository = await new GitRepository(options.repository ?? resolve('data-plant/project.git')).initialize();
    const service = new Service(store, repository, { reportRunner: runReport,externalWorkers:options.externalWorkers,externalSamples:()=>gateway.snapshot(),bindSources:sources=>gateway.bind(sources??[]) });
    await service.start(demoFiles);
    const auth = new Auth(store), password = options.password ?? randomBytes(18).toString('base64url'), username = options.user ?? 'engineer';
    const created = auth.seed(username, password);
    const push = options.pushSubject ? new Push(store, options.pushSubject) : null;
    const root = await realpath(options.root ?? resolve('dist/plant'));
    const workerTokens=new Map<string,ReadonlySet<WorkerJobKind>>();
    for(const [token,kinds] of Object.entries(options.workerTokens??{})){
        if(token.length<24||!Array.isArray(kinds)||kinds.some(k=>!['report','sql','wasm'].includes(k)))throw new AppError('Invalid worker token configuration');
        workerTokens.set(createHash('sha256').update(token).digest('hex'),new Set(kinds));
    }
    const workerAccess=(req:IncomingMessage):ReadonlySet<WorkerJobKind>=>{
        const token=/^Bearer ([A-Za-z0-9._~-]{24,512})$/.exec(String(req.headers.authorization??''))?.[1];
        if(!token)throw new AppError('Worker authentication required',401);
        const digest=createHash('sha256').update(token).digest(),hex=digest.toString('hex');
        for(const [saved,kinds] of workerTokens){const bytes=Buffer.from(saved,'hex');if(bytes.length===digest.length&&timingSafeEqual(bytes,digest))return kinds;}
        throw new AppError('Invalid worker token',401);
    };
    const streams = new Set<import('node:http').ServerResponse>();
    let origin = options.publicUrl ? new URL(options.publicUrl).origin : '';
    const server = createServer(async (req, res) => {
        const json = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(value)); };
        const html = (status: number, text: string) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(text); };
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self'; connect-src 'self'; img-src 'self' data:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'");
        try {
            const url = new URL(req.url ?? '/', origin || 'http://localhost');
            let path: string;
            try {
                path = decodeURIComponent(url.pathname);
            }
            catch {
                throw new AppError('Malformed URL');
            }
            if (req.method === 'POST' && req.headers.origin !== origin)
                throw new AppError('Cross-origin write blocked', 403);
            if (path === '/') {
                res.writeHead(302, { Location: `${prefix}/app/`, 'Cache-Control': 'no-store' }).end();
                return;
            }
            if (path === `${prefix}/api/health` && req.method === 'GET') {
                json(service.healthy ? 200 : 503, { status: service.healthy ? 'ok' : 'storage-unavailable', mode: 'simulation', releaseError: !!service.releaseError });
                return;
            }
            if (path === `${prefix}/api/login` && req.method === 'POST') {
                const input = await body(req), session = auth.login(input.user, input.password, req.socket.remoteAddress ?? 'unknown');
                res.setHeader('Set-Cookie', `scada_session=${session.token}; HttpOnly; SameSite=Strict; Path=${prefix}/; Max-Age=28800${origin.startsWith('https:') ? '; Secure' : ''}`);
                json(200, { actor: session.actor, csrf: session.csrf });
                return;
            }
            if (path === `${prefix}/login` && req.method === 'GET') {
                html(200, `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="./assets/app.css"><title>SCADA · Вход</title></head><body class="login"><main><p class="eyebrow">SCADA / NODE.JS</p><h1>Вход на установку</h1><form id="login"><label>Пользователь<input name="user" autocomplete="username" required></label><label>Пароль<input name="password" type="password" autocomplete="current-password" required></label><button>Войти</button><p id="error" role="alert"></p></form><a href="./demo/">Открыть автономную демонстрацию</a></main><script src="./assets/login.js" type="module"></script></body></html>`);
                return;
            }
            if (path === `${prefix}/app/`) {
                if (req.method !== 'GET')
                    throw new AppError('Method not allowed', 405);
                try {
                    auth.session(req.headers.cookie);
                }
                catch {
                    res.writeHead(302, { Location: `${prefix}/login`, 'Cache-Control': 'no-store' }).end();
                    return;
                }
                html(200, await readFile(resolve(root, 'index.html'), 'utf8'));
                return;
            }
            if(path.startsWith(`${prefix}/worker/`)){
                if(req.method!=='POST')throw new AppError('Method not allowed',405);
                const allowed=workerAccess(req),action=path.slice(`${prefix}/worker/`.length),input=await body(req);
                if(action==='claim'){
                    const requested=Array.isArray(input.kinds)?input.kinds.filter((k:unknown):k is WorkerJobKind=>typeof k==='string'&&allowed.has(k as WorkerJobKind)):[...allowed];
                    json(200,{job:service.claimWorker(requested,input.workerId)});return;
                }
                if(action==='complete'){
                    service.completeWorker(input.jobId,input.workerId,input.result,typeof input.error==='string'?input.error:undefined);
                    json(200,{ok:true});return;
                }
                throw new AppError('Worker endpoint not found',404);
            }
            if (path.startsWith(`${prefix}/api/`)) {
                const session = auth.session(req.headers.cookie), actor = session.actor;
                if (req.method === 'POST' && req.headers['x-csrf-token'] !== session.csrf)
                    throw new AppError('Invalid CSRF token', 403);
                const action = path.slice(`${prefix}/api/`.length);
                if (req.method === 'GET') {
                    if (action === 'session') {
                        json(200, { ...await service.status(actor), capabilities:capabilities(actor), csrf: session.csrf, push: push ? { publicKey: push.keys.publicKey } : null });
                        return;
                    }
                    if (action === 'project') {
                        json(200, await service.files(actor));
                        return;
                    }
                    if (action === 'revisions') {
                        authorize(actor,'project.source.read');
                        json(200, (await repository.log()).map(({ files, ...meta }) => meta));
                        return;
                    }
                    if (action === 'events') {
                        json(200, store.events(service.kernel.state.runId));
                        return;
                    }
                    if (action === 'reports') {
                        json(200, service.reports());
                        return;
                    }
                    if(action==='jobs'){json(200,service.jobs(actor));return;}
                    if(action==='drivers'){authorize(actor,'project.source.read');json(200,{drivers:registry.list(),connections:[...gateway.connections.keys()]});return;}
                    if (action === 'history') {
                        json(200, service.history((url.searchParams.get('signals') ?? '').split(',').filter(Boolean), Number(url.searchParams.get('from')), Number(url.searchParams.get('to'))));
                        return;
                    }
                    if (action === 'report') {
                        const artifact = service.reportArtifact(url.searchParams.get('id') ?? '');
                        res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:");
                        html(200, artifact.html);
                        return;
                    }
                    if (action === 'stream') {
                        if (streams.size >= 32)
                            throw new AppError('Too many streams', 429);
                        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
                        streams.add(res);
                        const write = (frame: unknown) => { try {
                            auth.session(req.headers.cookie);
                        }
                        catch {
                            res.end();
                            return;
                        } if (res.writableLength > 1048576) {
                            res.destroy();
                            return;
                        } res.write(`event: frame\ndata: ${JSON.stringify(frame)}\n\n`); };
                        write(service.frame());
                        const unsubscribe = service.subscribe(write), timer = setInterval(() => { try {
                            auth.session(req.headers.cookie);
                            if (service.kernel.state.paused)
                                write(service.frame());
                            else
                                res.write(': heartbeat\n\n');
                        }
                        catch {
                            res.end();
                        } }, 10000);
                        res.on('close', () => { clearInterval(timer); unsubscribe(); streams.delete(res); });
                        return;
                    }
                }
                if (req.method === 'POST') {
                    const input = await body(req);
                    if (action === 'logout') {
                        auth.logout(session.sessionId);
                        res.setHeader('Set-Cookie', `scada_session=; Path=${prefix}/; HttpOnly; SameSite=Strict; Max-Age=0`);
                        json(200, { ok: true });
                        return;
                    }
                    if (action === 'firmware') { json(200, service.firmware(input.controllerId,input.revision,actor)); return; }
                    if (action === 'command') {
                        json(200, service.command(input, actor));
                        return;
                    }
                    if (action === 'restart') {
                        json(200, await service.restart(actor));
                        return;
                    }
                    if (action === 'save') {
                        json(200, await service.save(input.files, input.expected, input.message, actor));
                        return;
                    }
                    if (action === 'publish') {
                        json(200, await service.publish(input.revision, input.expected, actor));
                        return;
                    }
                    if (action === 'rollback') {
                        json(200, await service.rollback(input.revision, input.expected, actor));
                        return;
                    }
                    if (action === 'report') {
                        json(202, service.dispatch(input.reportId, input.inputs ?? {}, actor));
                        return;
                    }
                    if(action==='job'){
                        if(input.kind!=='sql'&&input.kind!=='wasm')throw new AppError('Invalid worker job');
                        json(202,service.submitJob(input.kind,input.payload??{},actor));return;
                    }
                    if (action === 'subscribe') {
                        if (!push)
                            throw new AppError('Configure SCADA_PUSH_SUBJECT to enable Web Push', 503);
                        json(200, push.subscribe(input, actor, session.sessionId));
                        return;
                    }
                    if (action === 'unsubscribe') {
                        push?.unsubscribe(input.endpoint, actor);
                        json(200, { ok: true });
                        return;
                    }
                }
                throw new AppError('Endpoint not found', 404);
            }
            if (!['GET', 'HEAD'].includes(req.method ?? ''))
                throw new AppError('Method not allowed', 405);
            if (path === `${prefix}/demo/`) {
                html(200, await readFile(resolve(root, 'index.html'), 'utf8'));
                return;
            }
            if (path === `${prefix}/demo/manifest.webmanifest`) {
                res.writeHead(200, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' }).end(await readFile(resolve(root, 'demo/manifest.webmanifest')));
                return;
            }
            if (path === `${prefix}/manifest.webmanifest`) {
                const manifest = JSON.parse(await readFile(resolve(root, 'manifest.webmanifest'), 'utf8'));
                manifest.start_url = './app/';
                res.writeHead(200, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' }).end(JSON.stringify(manifest));
                return;
            }
            if (!path.startsWith(`${prefix}/assets/`) && path !== `${prefix}/sw.js`)
                throw new AppError('File not found', 404);
            const file = await realpath(resolve(root, '.' + path.slice(prefix.length)));
            if (!file.startsWith(root + sep))
                throw new AppError('Path rejected', 403);
            const mime: Record<string, string> = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
            res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
            res.end(req.method === 'HEAD' ? undefined : await readFile(file));
        }
        catch (error) {
            if (res.headersSent) {
                res.destroy();
                return;
            }
            const status = error instanceof AppError ? error.status : 500;
            json(status, { error: status === 500 ? 'Internal server error' : (error as Error).message });
            if (status === 500)
                console.error(error);
        }
    });
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(options.port ?? 4176, options.host ?? '127.0.0.1', () => { server.off('error', reject); accept(); }); });
    if (!origin)
        origin = `http://127.0.0.1:${(server.address() as {
            port: number;
        }).port}`;
    let timer: ReturnType<typeof setTimeout> | undefined, stopping = false;
    const step = () => { if (stopping)
        return; const started = performance.now(); try {
        service.tick();
    }
    catch (error) {
        console.error(error);
        for (const stream of streams)
            stream.destroy();
    } timer = setTimeout(step, Math.max(0, service.project.stepMs - (performance.now() - started))); };
    if (options.autoTick !== false)
        timer = setTimeout(step, service.project.stepMs);
    const ioControl=setInterval(()=>void gateway.refresh().catch(console.error),20);
    const control = options.autoTick === false ? undefined : setInterval(() => { try {
        service.schedule();
        void service.refreshRelease().catch(console.error);
        void push?.flush().catch(console.error);
    }
    catch (error) {
        console.error(error);
    } }, 1000);
    return { server, service, auth, push, origin, initialPassword: created ? password : null, async close() { stopping = true; clearTimeout(timer); clearInterval(control); for (const stream of streams)
            stream.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); await service.idle(); clearInterval(ioControl); await gateway.close(); store.db.close(); } };
}
