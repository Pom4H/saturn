import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { BunSql } from './adapters/bun-sql';
import { BunAuth } from './adapters/bun-auth';
import { Push } from './adapters/push';
import { runReport } from './adapters/bun-reports';
import { Store } from './store';
import { migrate } from './migrations';
import { Service } from './service';
import { requireRole } from './types';
import { AppError, failCode } from './diagnostics';
import { commandValue, nullableStringValue, numberMapValue, objectValue, stringValue, type JsonObject } from './http-input';
import { demoFiles } from "../examples/plant/files";
import { buildArtifact, type BuildArtifact } from './artifact';

const prefix = '/plant';
const maxBodySize = 2_100_000;
const liveTopic = 'saturn:plant:frames';
const encoder = new TextEncoder();

interface WebSocketData { cookie: string }
interface ServerWebSocketLike<T> {
    data: T;
    subscribe(topic: string): unknown;
    send(data: string): number;
    close(code?: number, reason?: string): void;
}
interface BunServerLike {
    readonly port?: number;
    readonly url: URL;
    requestIP(request: Request): { address?: string } | null;
    upgrade(request: Request, options: { data: WebSocketData }): boolean;
    publish(topic: string, data: string, compress?: boolean): number;
    subscriberCount(topic: string): number;
    timeout(request: Request, seconds: number): void;
    stop(closeActiveConnections?: boolean): Promise<void>;
}
interface BunCronJobLike { stop(): unknown }
interface BunRuntimeLike {
    serve(options: Record<string, unknown>): BunServerLike;
    file(path: string): Blob;
    cron(expression: string, callback: () => void | Promise<void>): BunCronJobLike;
}
const bunRuntime = (() => {
    const runtime = (globalThis as typeof globalThis & { Bun?: BunRuntimeLike }).Bun;
    if (!runtime) throw new Error('Saturn native server requires Bun. Use the version pinned in .bun-version.');
    return runtime;
})();

const defaultSecurityHeaders: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'",
};

function response(body: BodyInit | null, status = 200, headers: HeadersInit = {}): Response {
    const merged = new Headers(defaultSecurityHeaders);
    for (const [key, value] of new Headers(headers)) merged.set(key, value);
    return new Response(body, { status, headers: merged });
}
const json = (status: number, value: unknown, headers: HeadersInit = {}) =>
    response(JSON.stringify(value), status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...Object.fromEntries(new Headers(headers)) });
const html = (status: number, value: string) =>
    response(value, status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });

async function body(request: Request): Promise<JsonObject> {
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
        failCode('SATURN_HTTP_INVALID', { reason:'missing' }, { field:'content-type' }, { status:415 });
    const length = Number(request.headers.get('content-length') ?? 0);
    if (Number.isFinite(length) && length > maxBodySize)
        failCode('SATURN_LIMIT', { resource:'http.body', reason:'tooLarge' }, { bytes:length, max:maxBodySize }, { status:413 });
    const source = await request.text();
    if (encoder.encode(source).byteLength > maxBodySize)
        failCode('SATURN_LIMIT', { resource:'http.body', reason:'tooLarge' }, { max:maxBodySize }, { status:413 });
    let parsed: unknown;
    try { parsed = JSON.parse(source); }
    catch { failCode('SATURN_HTTP_INVALID', { reason:'malformed' }, { field:'json' }); }
    return objectValue(parsed);
}

async function safeFile(root: string, relative: string): Promise<string> {
    const file = await realpath(resolve(root, relative));
    if (file !== root && !file.startsWith(root + sep))
        failCode('SATURN_PERMISSION', { role:'engineer' }, { reason:'pathRejected', relative }, { status:403 });
    return file;
}
function fileResponse(path: string, type: string, head = false, extra: HeadersInit = {}): Response {
    return response(head ? null : bunRuntime.file(path), 200, {
        'Content-Type': type,
        'Cache-Control': 'no-cache',
        ...Object.fromEntries(new Headers(extra)),
    });
}

export async function startPlantServer(options: {
    port?: number;
    host?: string;
    data?: string;
    artifact?: BuildArtifact;
    publicUrl?: string;
    user?: string;
    password?: string;
    root?: string;
    autoTick?: boolean;
    pushSubject?: string;
    unix?: string;
    tls?: { cert: string; key: string; ca?: string[] };
    http2?: boolean;
} = {}) {
    const database = new BunSql(options.data ?? resolve('data-plant/runtime.sqlite3'));
    migrate(database);
    const store = new Store(database);
    const seed = options.artifact ?? await buildArtifact(demoFiles, { packageName: '@saturn/demo' });
    const service = new Service(store, { reportRunner: runReport });
    await service.start(seed);

    const auth = new BunAuth(store);
    const password = options.password ?? randomBytes(18).toString('base64url');
    const username = options.user ?? 'engineer';
    const created = await auth.seed(username, password);
    const push = options.pushSubject ? new Push(store, options.pushSubject) : null;
    const root = await realpath(options.root ?? resolve('dist/plant'));
    const sockets = new Set<ServerWebSocketLike<WebSocketData>>();
    let streamCount = 0;
    let origin = options.publicUrl ? new URL(options.publicUrl).origin : '';
    if (options.unix && !origin)
        throw new Error('SCADA_PUBLIC_URL is required when the Bun server listens on a Unix socket');
    const listen = options.unix
        ? { unix: options.unix }
        : {
            hostname: options.host ?? '127.0.0.1',
            port: options.port ?? 4176,
            http2: options.http2 ?? !!options.tls,
            ...(options.tls ? {
                tls: {
                    cert: bunRuntime.file(options.tls.cert),
                    key: bunRuntime.file(options.tls.key),
                    ...(options.tls.ca?.length ? { ca: options.tls.ca.map(path => bunRuntime.file(path)) } : {}),
                },
            } : {}),
        };

    const server = bunRuntime.serve({
        id: 'saturn-plant',
        ...listen,
        development: false,
        idleTimeout: 15,
        maxRequestBodySize: maxBodySize,
        fetch: async (request: Request, server: BunServerLike): Promise<Response | undefined> => {
            try {
                const url = new URL(request.url);
                let path: string;
                try { path = decodeURIComponent(url.pathname); }
                catch { failCode('SATURN_HTTP_INVALID',{reason:'malformed'},{field:'url'}); }

                if (request.method === 'POST' && request.headers.get('origin') !== origin)
                    failCode('SATURN_PERMISSION',{role:'operator'},{reason:'crossOriginWrite'},{status:403});

                if (path === '/') {
                    if (!['GET', 'HEAD'].includes(request.method)) failCode('SATURN_HTTP_INVALID',{reason:'disabled'},{method:request.method},{status:405});
                    const text = (await readFile(resolve(root, 'site/index.html'), 'utf8')).replaceAll('/plant/', `${prefix}/`);
                    return html(200, request.method === 'HEAD' ? '' : text);
                }

                if (path === `${prefix}/api/health` && request.method === 'GET')
                    return json(service.healthy ? 200 : 503, { status: service.healthy ? 'ok' : 'storage-unavailable', mode: 'simulation', runtime: 'bun', releaseError: !!service.releaseError });

                if (path === `${prefix}/api/login` && request.method === 'POST') {
                    const input = await body(request);
                    const session = await auth.login(stringValue(input,'user'), stringValue(input,'password'), server.requestIP(request)?.address ?? 'unknown');
                    const secure = origin.startsWith('https:') ? '; Secure' : '';
                    return json(200, { actor: session.actor, csrf: session.csrf }, {
                        'Set-Cookie': `scada_session=${session.token}; HttpOnly; SameSite=Strict; Path=${prefix}/; Max-Age=28800${secure}`,
                    });
                }

                if (path === `${prefix}/login` && request.method === 'GET') {
                    return html(200, `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="./assets/app.css"><title>Saturn · Вход</title></head><body class="login"><main><p class="eyebrow">SATURN / BUN</p><h1>Вход на установку</h1><form id="login"><label>Пользователь<input name="user" autocomplete="username" required></label><label>Пароль<input name="password" type="password" autocomplete="current-password" required></label><button>Войти</button><p id="error" role="alert"></p></form><a href="./demo/">Открыть автономную демонстрацию</a></main><script src="./assets/login.js" type="module"></script></body></html>`);
                }

                if (path === `${prefix}/app/`) {
                    if (request.method !== 'GET') failCode('SATURN_HTTP_INVALID',{reason:'disabled'},{method:request.method},{status:405});
                    try { auth.session(request.headers.get('cookie') ?? undefined); }
                    catch { return response(null, 302, { Location: `${prefix}/login`, 'Cache-Control': 'no-store' }); }
                    return html(200, await readFile(resolve(root, 'index.html'), 'utf8'));
                }

                if (path.startsWith(`${prefix}/api/`)) {
                    const cookie = request.headers.get('cookie') ?? undefined;
                    const session = auth.session(cookie);
                    const actor = session.actor;
                    if (request.method === 'POST' && request.headers.get('x-csrf-token') !== session.csrf)
                        failCode('SATURN_PERMISSION',{role:'operator'},{reason:'csrf'},{status:403});
                    const action = path.slice(`${prefix}/api/`.length);

                    if (request.method === 'GET') {
                        if (action === 'ws') {
                            if (request.headers.get('origin') !== origin) failCode('SATURN_PERMISSION',{role:'viewer'},{reason:'crossOriginWebSocket'},{status:403});
                            if (server.subscriberCount(liveTopic) >= 32) failCode('SATURN_LIMIT',{resource:'websocket.connections',reason:'tooMany'},{max:32},{status:429});
                            return server.upgrade(request, { data: { cookie: cookie ?? '' } })
                                ? undefined
                                : json(426, { error: 'WebSocket upgrade required' }, { Upgrade: 'websocket' });
                        }
                        if (action === 'session')
                            return json(200, { ...await service.status(actor), csrf: session.csrf, uiMode: 'runtime', transport: { sse: true, websocket: true }, push: push ? { publicKey: push.keys.publicKey } : null });
                        if (action === 'artifact') return json(200, service.artifactInfo(actor));
                        if (action === 'events') return json(200, store.events(service.kernel.state.runId));
                        if (action === 'reports') return json(200, service.reports());
                        if (action === 'history')
                            return json(200, service.history((url.searchParams.get('signals') ?? '').split(',').filter(Boolean), Number(url.searchParams.get('from')), Number(url.searchParams.get('to'))));
                        if (action === 'report') {
                            const artifact = service.reportArtifact(url.searchParams.get('id') ?? '');
                            return response(artifact.html, 200, {
                                'Content-Type': 'text/html; charset=utf-8',
                                'Cache-Control': 'no-store',
                                'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
                            });
                        }
                        if (action === 'stream') {
                            if (streamCount >= 32) failCode('SATURN_LIMIT',{resource:'sse.connections',reason:'tooMany'},{max:32},{status:429});
                            server.timeout(request, 0);
                            streamCount++;
                            let closed = false;
                            let unsubscribe = () => {};
                            let heartbeat: ReturnType<typeof setInterval> | undefined;
                            const stream = new ReadableStream<Uint8Array>({
                                start(controller) {
                                    const close = () => {
                                        if (closed) return;
                                        closed = true;
                                        streamCount--;
                                        if (heartbeat) clearInterval(heartbeat);
                                        unsubscribe();
                                        try { controller.close(); } catch { /* already closed */ }
                                    };
                                    const write = (frame: unknown) => {
                                        try { auth.session(cookie); }
                                        catch { close(); return; }
                                        if (controller.desiredSize !== null && controller.desiredSize < 0) { close(); return; }
                                        try { controller.enqueue(encoder.encode(`event: frame\ndata: ${JSON.stringify(frame)}\n\n`)); }
                                        catch { close(); }
                                    };
                                    write(service.frame());
                                    unsubscribe = service.subscribe(write);
                                    heartbeat = setInterval(() => {
                                        try {
                                            auth.session(cookie);
                                            if (service.kernel.state.paused) write(service.frame());
                                            else controller.enqueue(encoder.encode(': heartbeat\n\n'));
                                        } catch { close(); }
                                    }, 10_000);
                                },
                                cancel() {
                                    if (closed) return;
                                    closed = true;
                                    streamCount--;
                                    if (heartbeat) clearInterval(heartbeat);
                                    unsubscribe();
                                },
                            });
                            return response(stream, 200, {
                                'Content-Type': 'text/event-stream; charset=utf-8',
                                'Cache-Control': 'no-store',
                                'X-Accel-Buffering': 'no',
                            });
                        }
                    }

                    if (request.method === 'POST') {
                        const input = await body(request);
                        if (action === 'logout') {
                            auth.logout(session.sessionId);
                            return json(200, { ok: true }, { 'Set-Cookie': `scada_session=; Path=${prefix}/; HttpOnly; SameSite=Strict; Max-Age=0` });
                        }
                        if (action === 'firmware') return json(200, service.firmware(stringValue(input,'controllerId'), stringValue(input,'revision'), actor));
                        if (action === 'command') return json(200, service.command(commandValue(input), actor));
                        if (action === 'restart') return json(200, await service.restart(actor));
                        if (action === 'deploy') {
                            requireRole(actor, 'engineer');
                            return json(200, await service.deploy(input.artifact, nullableStringValue(input,'expected'), actor));
                        }
                        if (action === 'rollback') return json(200, await service.rollback(stringValue(input,'hash'), nullableStringValue(input,'expected'), actor));
                        if (action === 'report') return json(202, service.dispatch(stringValue(input,'reportId'), numberMapValue(input.inputs,'inputs'), actor));
                        if (action === 'subscribe') {
                            if (!push) failCode('SATURN_RUNTIME_INVALID',{reason:'missing'},{resource:'push.subject'},{status:503});
                            return json(200, push.subscribe(input, actor, session.sessionId));
                        }
                        if (action === 'unsubscribe') {
                            push?.unsubscribe(stringValue(input,'endpoint'), actor);
                            return json(200, { ok: true });
                        }
                    }
                    failCode('SATURN_NOT_FOUND',{resource:'http.endpoint',id:action},{path},{status:404});
                }

                if (!['GET', 'HEAD'].includes(request.method)) failCode('SATURN_HTTP_INVALID',{reason:'disabled'},{method:request.method},{status:405});
                const head = request.method === 'HEAD';
                if (path === '/saturn-sw.js') {
                    const file = await safeFile(root, 'site/saturn-sw.js');
                    return fileResponse(file, 'text/javascript', head, { 'Service-Worker-Allowed': '/' });
                }
                if (path.startsWith('/site/assets/')) {
                    const siteRoot = await realpath(resolve(root, 'site/assets'));
                    const file = await safeFile(siteRoot, path.slice('/site/assets/'.length));
                    const mime: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.txt': 'text/plain', '.md': 'text/plain; charset=utf-8' };
                    return fileResponse(file, mime[extname(file)] ?? 'application/octet-stream', head);
                }
                if (path === `${prefix}/demo/`) {
                    const file = await safeFile(root, 'index.html');
                    return fileResponse(file, 'text/html; charset=utf-8', head);
                }
                if (path === `${prefix}/demo/manifest.webmanifest`) {
                    const file = await safeFile(root, 'demo/manifest.webmanifest');
                    return fileResponse(file, 'application/manifest+json', head);
                }
                if (path === `${prefix}/manifest.webmanifest`) {
                    const manifest = JSON.parse(await readFile(resolve(root, 'manifest.webmanifest'), 'utf8'));
                    manifest.start_url = './app/';
                    return response(head ? null : JSON.stringify(manifest), 200, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' });
                }
                if (!path.startsWith(`${prefix}/assets/`) && path !== `${prefix}/sw.js`)
                    failCode('SATURN_NOT_FOUND',{resource:'file',id:path},{path},{status:404});
                const file = await safeFile(root, '.' + path.slice(prefix.length));
                const mime: Record<string, string> = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain' };
                return fileResponse(file, mime[extname(file)] ?? 'application/octet-stream', head);
            } catch (error) {
                const status = error instanceof AppError ? error.status : 500;
                if (status === 500) console.error(error);
                return json(status, { error: status === 500 ? 'Internal server error' : (error as Error).message });
            }
        },
        websocket: {
            data: {} as WebSocketData,
            maxPayloadLength: 1024,
            backpressureLimit: 1_048_576,
            closeOnBackpressureLimit: true,
            idleTimeout: 120,
            sendPings: true,
            perMessageDeflate: false,
            open(ws: ServerWebSocketLike<WebSocketData>) {
                try {
                    auth.session(ws.data.cookie);
                    sockets.add(ws);
                    ws.subscribe(liveTopic);
                    ws.send(JSON.stringify({ type: 'frame', frame: service.frame() }));
                } catch {
                    ws.close(1008, 'Session expired');
                }
            },
            message(ws: ServerWebSocketLike<WebSocketData>, message: string | Uint8Array) {
                if (typeof message === 'string' && message === 'ping') {
                    try {
                        auth.session(ws.data.cookie);
                        ws.send('pong');
                    } catch { ws.close(1008, 'Session expired'); }
                    return;
                }
                ws.close(1008, 'Live WebSocket is read-only');
            },
            close(ws: ServerWebSocketLike<WebSocketData>) { sockets.delete(ws); },
        },
    });

    if (!origin) {
        const host = options.host ?? '127.0.0.1';
        const urlHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host;
        const scheme = options.tls ? 'https' : 'http';
        origin = `${scheme}://${urlHost}:${server.port ?? options.port ?? 4176}`;
    }

    const unsubscribeWebSockets = service.subscribe(frame => {
        server.publish(liveTopic, JSON.stringify({ type: 'frame', frame }));
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopping = false;
    const step = () => {
        if (stopping) return;
        const started = performance.now();
        try { service.tick(); }
        catch (error) { console.error(error); for (const socket of sockets) socket.close(1011, 'Runtime error'); }
        timer = setTimeout(step, Math.max(0, service.project.stepMs - (performance.now() - started)));
    };
    if (options.autoTick !== false) timer = setTimeout(step, service.project.stepMs);

    const schedule = options.autoTick === false ? undefined : bunRuntime.cron('* * * * *', () => {
        try { service.schedule(); }
        catch (error) { console.error(error); }
    });

    const control = options.autoTick === false ? undefined : setInterval(() => {
        try {
            void service.refreshRelease().catch(console.error);
            void push?.flush().catch(console.error);
        } catch (error) { console.error(error); }
    }, 1000);

    const socketAuth = setInterval(() => {
        for (const socket of sockets) {
            try { auth.session(socket.data.cookie); }
            catch { socket.close(1008, 'Session expired'); }
        }
    }, 60_000);

    return {
        server, service, auth, push, origin, initialPassword: created ? password : null,
        async close() {
            if (stopping) return;
            stopping = true;
            if (timer) clearTimeout(timer);
            if (control) clearInterval(control);
            schedule?.stop();
            clearInterval(socketAuth);
            unsubscribeWebSockets();
            for (const socket of sockets) socket.close(1001, 'Server shutdown');
            await server.stop(true);
            await service.idle();
            store.db.close();
        },
    };
}
