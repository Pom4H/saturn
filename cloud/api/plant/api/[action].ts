import type { IncomingMessage, ServerResponse } from 'node:http';
import {
    authenticateSession,
    history,
    login,
    logout,
    publicInstance,
    queueCommand,
    requireCsrf,
    requireRole,
    sessionState,
    siteBySlug,
    siteSlugFromRequest,
    waitForCommand,
} from '../../_lib/state.js';
import { httpError, readJson, requestUrl, sendError, sendJson } from '../../_lib/http.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function actionFromRequest(request: IncomingMessage): string {
    const url = requestUrl(request);
    const parts = url.pathname.split('/').filter(Boolean);
    return decodeURIComponent(parts.at(-1) ?? '');
}

function stringValue(value: unknown, name: string): string {
    if (typeof value !== 'string' || !value)
        throw httpError(400, `${name} is required`);
    return value;
}

function numberValue(value: string | null, name: string): number {
    const result = Number(value);
    if (!Number.isFinite(result))
        throw httpError(400, `${name} must be a number`);
    return result;
}

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
        const slug = siteSlugFromRequest(request);
        let site = await siteBySlug(slug);
        if (!site) throw httpError(404, 'Unknown Saturn Cloud site');
        const action = actionFromRequest(request);

        if (action === 'health' && request.method === 'GET') {
            sendJson(response, 200, { status: 'ok', mode: 'cloud' });
            return;
        }

        if (action === 'login' && request.method === 'POST') {
            const input = await readJson(request);
            const mode = input.mode === 'bearer';
            const session = await login(
                site,
                stringValue(input.user, 'user'),
                stringValue(input.password, 'password'),
                mode,
            );
            if (mode) {
                sendJson(response, 200, {
                    actor: session.actor,
                    token: session.token,
                    expiresIn: 28_800,
                });
            }
            else {
                sendJson(response, 200, {
                    actor: session.actor,
                    csrf: session.csrf,
                }, {
                    'Set-Cookie': `saturn_cloud_session=${encodeURIComponent(session.token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`,
                });
            }
            return;
        }

        const session = await authenticateSession(request, site);

        if (request.method === 'GET') {
            if (action === 'instance') {
                site = await siteBySlug(slug) ?? site;
                const instance = publicInstance(site);
                if (typeof instance.instanceId !== 'string' || typeof instance.projectId !== 'string' || typeof instance.applied !== 'string' || typeof instance.runId !== 'string')
                    throw httpError(409, 'Site has not connected to Saturn Cloud yet');
                sendJson(response, 200, { ...instance, actor: session.actor });
                return;
            }
            if (action === 'session') {
                site = await siteBySlug(slug) ?? site;
                sendJson(response, 200, {
                    ...sessionState(site, session.actor),
                    csrf: session.bearer ? undefined : session.csrf,
                });
                return;
            }
            if (action === 'events' || action === 'reports') {
                sendJson(response, 200, []);
                return;
            }
            if (action === 'history') {
                const url = requestUrl(request);
                const signals = (url.searchParams.get('signals') ?? '').split(',').map(value => value.trim()).filter(Boolean);
                sendJson(response, 200, await history(
                    site,
                    signals,
                    numberValue(url.searchParams.get('from'), 'from'),
                    numberValue(url.searchParams.get('to'), 'to'),
                ));
                return;
            }
            if (action === 'stream') {
                response.writeHead(200, {
                    'Content-Type': 'text/event-stream; charset=utf-8',
                    'Cache-Control': 'no-store',
                    'X-Accel-Buffering': 'no',
                    Connection: 'keep-alive',
                });
                let closed = false;
                request.once('close', () => { closed = true; });
                const deadline = Date.now() + 29 * 60 * 1000;
                let previous = '';
                while (!closed && Date.now() < deadline) {
                    const current = await siteBySlug(slug);
                    if (!current) break;
                    const state = sessionState(current, session.actor);
                    const frame = state.frame;
                    const online = (state.cloud as { online?: unknown }).online === true;
                    const frameRecord = frame && typeof frame === 'object' && !Array.isArray(frame)
                        ? frame as Record<string, unknown> : null;
                    const key = JSON.stringify([frameRecord?.runId ?? null, frameRecord?.seq ?? null, online]);
                    if (key !== previous) {
                        previous = key;
                        response.write(`event: frame\ndata: ${JSON.stringify(frame)}\n\n`);
                    }
                    else {
                        response.write(': heartbeat\n\n');
                    }
                    await sleep(1000);
                }
                response.end();
                return;
            }
            throw httpError(404, 'Unknown Saturn Cloud endpoint');
        }

        if (request.method === 'POST') {
            requireCsrf(request, session);
            if (action === 'logout') {
                await logout(session);
                sendJson(response, 200, { ok: true }, {
                    'Set-Cookie': 'saturn_cloud_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0',
                });
                return;
            }
            if (action === 'command') {
                requireRole(session.actor, 'operator');
                const payload = await readJson(request);
                site = await siteBySlug(slug) ?? site;
                const cloudId = await queueCommand(site, payload, session.actor);
                const result = await waitForCommand(cloudId);
                if (result.status === 'applied') {
                    sendJson(response, 200, result.receipt);
                    return;
                }
                if (result.status === 'rejected')
                    throw httpError(409, result.error ?? 'Runtime rejected command');
                sendJson(response, 202, { id: cloudId, status: result.status });
                return;
            }
            if (action === 'restart')
                throw httpError(501, 'Remote runtime restart is not part of the Saturn Cloud MVP');
            throw httpError(404, 'Unknown Saturn Cloud endpoint');
        }

        sendJson(response, 405, { error: 'Method not allowed' });
    }
    catch (error) {
        sendError(response, error);
    }
}
