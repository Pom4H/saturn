import { createServer, type IncomingMessage } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Auth } from './adapters/auth';
import { EnvironmentBroker } from './environment';
import { Push } from './adapters/push';
import { Store } from './store';
import { Service } from './service';
import { AppError, requireRole, type Repository, type SqlDatabase, type ReportTask, type ReportArtifact } from './types';
import { diagnosticLocale, errorPayload, failCode } from './diagnostics';
const prefix = '/plant';
async function body<T = Record<string, unknown>>(req: IncomingMessage): Promise<T> { if (!req.headers['content-type']?.startsWith('application/json'))
    failCode('SATURN_HTTP_INVALID',{reason:'malformed'},{field:'content-type'},{status:415}); let size = 0; const chunks: Buffer[] = []; for await (const chunk of req) {
    size += chunk.length;
    if (size > 2100000)
        failCode('SATURN_LIMIT',{resource:'http.request',reason:'tooLarge'},{limitBytes:2100000},{status:413});
    chunks.push(chunk);
} try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}
catch {
    failCode('SATURN_HTTP_INVALID',{reason:'malformed'},{field:'json'});
} }
export async function startPlantHttpServer(options: {
    port?: number;
    host?: string;
    publicUrl?: string;
    user?: string;
    password?: string;
    root?: string;
    autoTick?: boolean;
    pushSubject?: string;
    uiMode?: 'ide' | 'runtime' | 'kiosk';
    application?: {
        version: string;
        extensions?: {
            list(): Promise<Array<{ id: string; name: string; version: string; entry: string; capabilities: string[]; elements: Array<{ type: string; title: string; tag: string }> }>>;
            install(specifier: string): Promise<{ id: string; name: string; version: string; entry: string; capabilities: string[]; elements: Array<{ type: string; title: string; tag: string }> }>;
            remove(name: string): Promise<void>;
            readAsset(id: string, path: string): Promise<Uint8Array>;
        };
        update?: {
            check(): Promise<{ configured: boolean; available: boolean; currentVersion: string; version?: string; channel?: string; publishedAt?: string; target?: string }>;
            install(): Promise<{ scheduled: true; version: string }>;
        };
    };
    embeddedStatic?: boolean;
    staticReader?: (relativePath: string) => Promise<Uint8Array>;
    database: SqlDatabase;
    projectRepository: Repository;
    reportRunner: (task: ReportTask) => Promise<ReportArtifact>;
    seed: Record<string, string>;
}) {
    const database = options.database;
    const store = new Store(database);
    const repository = options.projectRepository;
    const service = new Service(store, repository, { reportRunner: options.reportRunner });
    await service.start(options.seed);
    const auth = new Auth(store), environments = new EnvironmentBroker(), password = options.password ?? randomBytes(18).toString('base64url'), username = options.user ?? 'engineer';
    const created = auth.seed(username, password);
    const push = options.pushSubject ? new Push(store, options.pushSubject) : null;
    const configuredRoot = resolve(options.root ?? resolve('dist/plant'));
    const root = options.embeddedStatic ? configuredRoot : await realpath(configuredRoot);
    const staticFile = async (relativePath: string) => {
        const candidate = resolve(root, relativePath);
        if (candidate !== root && !candidate.startsWith(root + sep))
            failCode('SATURN_PERMISSION',{role:'static-path'},{path:relativePath},{status:403});
        if (options.embeddedStatic)
            return candidate;
        const file = await realpath(candidate);
        if (file !== root && !file.startsWith(root + sep))
            failCode('SATURN_PERMISSION',{role:'static-path'},{path:relativePath},{status:403});
        return file;
    };
    const readStatic = async (relativePath: string): Promise<Buffer> => {
        const normalized = relativePath.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\//, '');
        if (!normalized || normalized.split('/').some(part => part === '..' || part === '.'))
            failCode('SATURN_PERMISSION',{role:'static-path'},{path:normalized},{status:403});
        if (options.staticReader)
            return Buffer.from(await options.staticReader(normalized));
        return readFile(await staticFile(normalized));
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
                failCode('SATURN_HTTP_INVALID',{reason:'malformed'},{field:'url'});
            }
            if (req.method === 'POST' && req.headers.origin && req.headers.origin !== origin)
                failCode('SATURN_PERMISSION',{role:'same-origin'},{origin:req.headers.origin},{status:403});
            if (path === '/') {
                if (!['GET', 'HEAD'].includes(req.method ?? '')) failCode('SATURN_HTTP_INVALID',{reason:'disabled'},{method:req.method,path},{status:405});
                html(200, req.method === 'HEAD' ? '' : (await readStatic('site/index.html')).toString('utf8').replaceAll('/plant/', `${prefix}/`));
                return;
            }
            if (path === `${prefix}/api/health` && req.method === 'GET') {
                json(service.healthy ? 200 : 503, { status: service.healthy ? 'ok' : 'storage-unavailable', mode: 'simulation', releaseError: !!service.releaseError });
                return;
            }
            if (path === `${prefix}/api/login` && req.method === 'POST') {
                const input = await body(req), session = auth.login(input.user, input.password, req.socket.remoteAddress ?? 'unknown');
                if (input.mode === 'bearer') {
                    const remote = req.socket.remoteAddress ?? '';
                    const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
                    if (!origin.startsWith('https:') && !loopback)
                        failCode('SATURN_HTTP_INVALID',{reason:'invalid'},{field:'bearer.transport'},{status:400});
                    json(200, { actor: session.actor, token: session.token, expiresIn: 28800 });
                }
                else {
                    res.setHeader('Set-Cookie', `scada_session=${session.token}; HttpOnly; SameSite=Strict; Path=${prefix}/; Max-Age=28800${origin.startsWith('https:') ? '; Secure' : ''}`);
                    json(200, { actor: session.actor, csrf: session.csrf });
                }
                return;
            }
            if (path === `${prefix}/login` && req.method === 'GET') {
                html(200, `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="./assets/app.css"><title>SCADA · Вход</title></head><body class="login"><main><p class="eyebrow">SCADA / NODE.JS</p><h1>Вход на установку</h1><form id="login"><label>Пользователь<input name="user" autocomplete="username" required></label><label>Пароль<input name="password" type="password" autocomplete="current-password" required></label><button>Войти</button><p id="error" role="alert"></p></form><a href="./demo/">Открыть автономную демонстрацию</a></main><script src="./assets/login.js" type="module"></script></body></html>`);
                return;
            }
            if (path === `${prefix}/app/`) {
                if (req.method !== 'GET')
                    failCode('SATURN_HTTP_INVALID',{reason:'disabled'},{method:req.method,path},{status:405});
                try {
                    auth.session(req.headers.cookie, req.headers.authorization);
                }
                catch {
                    res.writeHead(302, { Location: `${prefix}/login`, 'Cache-Control': 'no-store' }).end();
                    return;
                }
                html(200, (await readStatic('index.html')).toString('utf8'));
                return;
            }
            if (path.startsWith(`${prefix}/extensions/`) && req.method === 'GET') {
                auth.session(req.headers.cookie, req.headers.authorization);
                const host = options.application?.extensions;
                if (!host)
                    failCode('SATURN_NOT_FOUND',{resource:'extensions',id:'host'},{path},{status:404});
                const parts = path.slice(`${prefix}/extensions/`.length).split('/').filter(Boolean);
                const id = parts.shift() ?? '';
                const relative = parts.join('/');
                try {
                    const data = await host.readAsset(id, relative);
                    const mime: Record<string, string> = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
                    res.writeHead(200, { 'Content-Type': mime[extname(relative)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
                    res.end(data);
                }
                catch (error) {
                    failCode('SATURN_NOT_FOUND',{resource:'extensionAsset',id:relative},{extension:id,detail:error instanceof Error?error.message:String(error)},{status:404});
                }
                return;
            }
            if (path.startsWith(`${prefix}/api/`)) {
                const session = auth.session(req.headers.cookie, req.headers.authorization), actor = session.actor;
                if (req.method === 'POST' && !session.bearer && req.headers['x-csrf-token'] !== session.csrf)
                    failCode('SATURN_PERMISSION',{role:'csrf'},{action:path},{status:403});
                const action = path.slice(`${prefix}/api/`.length);

                if (action === 'environment/connect' && req.method === 'POST') {
                    requireRole(session.actor, 'engineer');
                    json(200, await environments.connect(session.sessionId, await body(req)));
                    return;
                }
                if (action === 'environment/disconnect' && req.method === 'POST') {
                    environments.disconnect(session.sessionId);
                    json(200, { ok: true });
                    return;
                }
                if (action === 'environment' && req.method === 'GET') {
                    json(200, environments.descriptor(session.sessionId));
                    return;
                }
                if (action === 'environment/stream' && req.method === 'GET') {
                    const remote = await environments.stream(session.sessionId);
                    if (!remote.ok || !remote.body) {
                        const message = await remote.text().catch(() => '');
                        failCode('SATURN_HTTP_INVALID',{reason:'stateChanged'},{remoteStatus:remote.status,...(message?{remoteMessage:message}:{})},{status:remote.status||502});
                    }
                    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
                    const reader = remote.body.getReader();
                    res.on('close', () => void reader.cancel());
                    while (!res.destroyed) {
                        const chunk = await reader.read();
                        if (chunk.done)
                            break;
                        if (!res.write(Buffer.from(chunk.value)))
                            await new Promise<void>(resolve => res.once('drain', resolve));
                    }
                    res.end();
                    return;
                }
                if (action.startsWith('environment/')) {
                    const remoteAction = action.slice('environment/'.length);
                    const query = new URLSearchParams(url.searchParams);
                    const input = req.method === 'POST' ? await body(req) : undefined;
                    const remote = await environments.request(session.sessionId, remoteAction, { method: req.method === 'POST' ? 'POST' : 'GET', query, body: input });
                    if (remoteAction === 'session' && req.method === 'GET') {
                        const value: unknown = await remote.json().catch(() => null);
                        if (!remote.ok) {
                            const remoteMessage=value&&typeof value==='object'&&'error' in value&&typeof (value as {error?:unknown}).error==='string'
                                ? (value as {error:string}).error : undefined;
                            failCode('SATURN_HTTP_INVALID',{reason:'stateChanged'},{remoteStatus:remote.status,...(remoteMessage?{remoteMessage}:{})},{status:remote.status||502});
                        }
                        if (!value || typeof value !== 'object' || Array.isArray(value))
                            failCode('SATURN_HTTP_INVALID',{reason:'malformed'},{field:'remote.session'},{status:502});
                        json(200, { ...(value as Record<string,unknown>), csrf: session.csrf });
                        return;
                    }
                    const contentType = remote.headers.get('content-type') ?? 'application/json; charset=utf-8';
                    const payload = Buffer.from(await remote.arrayBuffer());
                    res.writeHead(remote.status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' }).end(payload);
                    return;
                }
                if (req.method === 'GET') {
                    if (action === 'session') {
                        json(200, { ...await service.status(actor), csrf: session.bearer ? undefined : session.csrf, push: push ? { publicKey: push.keys.publicKey } : null, environment: environments.descriptor(session.sessionId), uiMode: options.uiMode ?? 'ide' });
                        return;
                    }
                    if (action === 'application/update') {
                        requireRole(actor, 'engineer');
                        const updater = options.application?.update;
                        if (!updater) {
                            json(200, { configured: false, available: false, currentVersion: options.application?.version ?? null });
                            return;
                        }
                        try {
                            json(200, await updater.check());
                        }
                        catch (error) {
                            console.warn('Saturn update check failed:', error);
                            json(200, { configured: true, available: false, currentVersion: options.application?.version ?? null });
                        }
                        return;
                    }
                    if (action === 'application') {
                        const installed = await options.application?.extensions?.list() ?? [];
                        json(200, {
                            version: options.application?.version ?? null,
                            extensions: installed.map(extension => ({
                                ...extension,
                                entryUrl: `${prefix}/extensions/${extension.id}/${extension.entry.split('/').map(encodeURIComponent).join('/')}`,
                            })),
                        });
                        return;
                    }
                    if (action === 'instance') {
                        json(200, await service.instance(actor));
                        return;
                    }
                    if (action === 'project') {
                        json(200, await service.files(actor));
                        return;
                    }
                    if (action === 'revisions') {
                        requireRole(actor, 'engineer');
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
                            failCode('SATURN_LIMIT',{resource:'streams',reason:'tooMany'},{max:32},{status:429});
                        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
                        streams.add(res);
                        const write = (frame: unknown) => { try {
                            auth.session(req.headers.cookie, req.headers.authorization);
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
                            auth.session(req.headers.cookie, req.headers.authorization);
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
                    if (action === 'application/update') {
                        requireRole(actor, 'engineer');
                        if (!options.application?.update)
                            failCode('SATURN_UPDATE_INVALID',{reason:'disabled'},{resource:'self-update'},{status:503});
                        json(202, await options.application.update.install());
                        return;
                    }
                    if (action === 'extensions/install') {
                        requireRole(actor, 'engineer');
                        if (!options.application?.extensions)
                            failCode('SATURN_EXTENSION_INVALID',{reason:'disabled'},{resource:'extension-host'},{status:503});
                        if (typeof input.specifier !== 'string')
                            failCode('SATURN_EXTENSION_INVALID',{reason:'missing'},{field:'specifier'});
                        const extension = await options.application.extensions.install(input.specifier);
                        json(200, { ...extension, entryUrl: `${prefix}/extensions/${extension.id}/${extension.entry.split('/').map(encodeURIComponent).join('/')}` });
                        return;
                    }
                    if (action === 'extensions/remove') {
                        requireRole(actor, 'engineer');
                        if (!options.application?.extensions)
                            failCode('SATURN_EXTENSION_INVALID',{reason:'disabled'},{resource:'extension-host'},{status:503});
                        if (typeof input.name !== 'string')
                            failCode('SATURN_EXTENSION_INVALID',{reason:'missing'},{field:'name'});
                        await options.application.extensions.remove(input.name);
                        json(200, { ok: true });
                        return;
                    }
                    if (action === 'logout') {
                        environments.disconnect(session.sessionId);
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
                    if (action === 'subscribe') {
                        if (!push)
                            failCode('SATURN_RUNTIME_INVALID',{reason:'disabled'},{resource:'push'},{status:503});
                        json(200, push.subscribe(input, actor, session.sessionId));
                        return;
                    }
                    if (action === 'unsubscribe') {
                        push?.unsubscribe(input.endpoint, actor);
                        json(200, { ok: true });
                        return;
                    }
                }
                failCode('SATURN_NOT_FOUND',{resource:'endpoint',id:action},{path},{status:404});
            }
            if (!['GET', 'HEAD'].includes(req.method ?? ''))
                failCode('SATURN_HTTP_INVALID',{reason:'disabled'},{method:req.method,path},{status:405});
            if (path === '/saturn-sw.js') {
                res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
                res.end(req.method === 'HEAD' ? undefined : await readStatic('site/saturn-sw.js'));
                return;
            }
            if (path.startsWith('/site/assets/')) {
                const file = await staticFile('site/assets/' + path.slice('/site/assets/'.length));
                const mime: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.txt': 'text/plain', '.md': 'text/plain; charset=utf-8' };
                res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
                res.end(req.method === 'HEAD' ? undefined : await readStatic('site/assets/' + path.slice('/site/assets/'.length)));
                return;
            }
            if (path === `${prefix}/demo/`) {
                html(200, (await readStatic('index.html')).toString('utf8'));
                return;
            }
            if (path === `${prefix}/demo/manifest.webmanifest`) {
                res.writeHead(200, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' }).end(await readStatic('demo/manifest.webmanifest'));
                return;
            }
            if (path === `${prefix}/manifest.webmanifest`) {
                const manifest = JSON.parse((await readStatic('manifest.webmanifest')).toString('utf8'));
                manifest.start_url = './app/';
                res.writeHead(200, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' }).end(JSON.stringify(manifest));
                return;
            }
            if (!path.startsWith(`${prefix}/assets/`) && path !== `${prefix}/sw.js`)
                failCode('SATURN_NOT_FOUND',{resource:'file',id:path},{path},{status:404});
            const file = await staticFile('.' + path.slice(prefix.length));
            const mime: Record<string, string> = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
            res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
            res.end(req.method === 'HEAD' ? undefined : await readStatic('.' + path.slice(prefix.length)));
        }
        catch (error) {
            if (res.headersSent) {
                res.destroy();
                return;
            }
            const status = error instanceof AppError ? error.status : 500;
            const locale = diagnosticLocale(req.headers['accept-language']);
            json(status, status === 500 ? { error: 'Internal server error', locale } : errorPayload(error, locale));
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
    const control = options.autoTick === false ? undefined : setInterval(() => { try {
        service.schedule();
        void service.refreshRelease().catch(console.error);
        void push?.flush().catch(console.error);
    }
    catch (error) {
        console.error(error);
    } }, 1000);
    return { server, service, auth, push, origin, initialPassword: created ? password : null, async close() { stopping = true; clearTimeout(timer); clearInterval(control); for (const stream of streams)
            stream.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); await service.idle(); store.db.close(); } };
}
