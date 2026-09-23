import type { Actor, Frame } from './types';
import { failCode } from './diagnostics';

export interface EnvironmentDescriptor {
    name: string;
    url: string;
    instanceId: string;
    projectId: string;
    applied: string;
    published: string | null;
    head: string | null;
    runId: string;
    role: Actor['role'];
}

interface EnvironmentLink {
    name: string;
    api: URL;
    token: string;
    descriptor: EnvironmentDescriptor;
}

const cleanName = (value: unknown) => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_. -]{1,80}$/.test(value))
        failCode('SATURN_VALUE_INVALID',{field:'environment.name',reason:'invalid'},{value});
    return value.trim();
};

const apiBase = (value: unknown): URL => {
    if (typeof value !== 'string' || value.length > 2048)
        failCode('SATURN_VALUE_INVALID',{field:'environment.url',reason:'invalid'});
    const input = new URL(value);
    if (!['http:', 'https:'].includes(input.protocol) || input.username || input.password || input.hash)
        failCode('SATURN_VALUE_INVALID',{field:'environment.url',reason:'invalid'},{protocol:input.protocol});
    // A Saturn installation is addressed by origin. Paths are deliberately not trusted.
    return new URL('/plant/api/', input.origin);
};

async function responseJson<T>(response: Response): Promise<T> {
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
        const remoteMessage = value && typeof value === 'object' && 'error' in value && typeof (value as {error?:unknown}).error === 'string'
            ? (value as {error:string}).error
            : undefined;
        failCode('SATURN_HTTP_INVALID',{reason:'stateChanged'},{status:response.status,...(remoteMessage?{remoteMessage}:{})},{status:response.status>=400&&response.status<600?response.status:502});
    }
    return value as T;
}

/**
 * Server-to-server live environment bridge.
 *
 * Browser credentials are exchanged for a short-lived bearer session and held only
 * in this process. Project files, Git and workspace metadata never receive secrets.
 */
export class EnvironmentBroker {
    private links = new Map<string, EnvironmentLink>();

    async connect(sessionId: string, input: {
        name?: unknown;
        url?: unknown;
        user?: unknown;
        password?: unknown;
    }): Promise<EnvironmentDescriptor> {
        const name = cleanName(input.name ?? 'production');
        const api = apiBase(input.url);
        if (typeof input.user !== 'string' || input.user.length > 100 || typeof input.password !== 'string' || input.password.length > 1024)
            failCode('SATURN_VALUE_INVALID',{field:'environment.credentials',reason:'invalid'});

        const login = await fetch(new URL('login', api), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: input.user, password: input.password, mode: 'bearer' }),
            signal: AbortSignal.timeout(10000),
            redirect: 'error',
        });
        const authenticated = await responseJson<{token: string; actor: Actor}>(login);
        if (!/^[A-Za-z0-9_-]{43}$/.test(authenticated.token))
            failCode('SATURN_HTTP_INVALID',{reason:'malformed'},{field:'session.token'},{status:502});

        const instanceResponse = await fetch(new URL('instance', api), {
            headers: { Authorization: `Bearer ${authenticated.token}` },
            signal: AbortSignal.timeout(10000),
            cache: 'no-store',
            redirect: 'error',
        });
        const instance = await responseJson<{
            instanceId: string;
            projectId: string;
            applied: string;
            published: string | null;
            head: string | null;
            runId: string;
        }>(instanceResponse);

        const descriptor: EnvironmentDescriptor = {
            name,
            url: api.origin,
            instanceId: instance.instanceId,
            projectId: instance.projectId,
            applied: instance.applied,
            published: instance.published,
            head: instance.head,
            runId: instance.runId,
            role: authenticated.actor.role,
        };
        this.links.set(sessionId, { name, api, token: authenticated.token, descriptor });
        return descriptor;
    }

    descriptor(sessionId: string): EnvironmentDescriptor | null {
        return this.links.get(sessionId)?.descriptor ?? null;
    }

    disconnect(sessionId: string): void {
        this.links.delete(sessionId);
    }

    private link(sessionId: string): EnvironmentLink {
        const link = this.links.get(sessionId);
        if (!link)
            failCode('SATURN_CONFLICT',{resource:'environment',reason:'missing'},{sessionId},{status:409});
        return link;
    }

    async request(sessionId: string, action: string, init: {
        method?: 'GET' | 'POST';
        query?: URLSearchParams;
        body?: unknown;
    } = {}): Promise<Response> {
        const allowed = new Set(['session', 'instance', 'events', 'reports', 'history', 'report', 'command', 'restart', 'firmware', 'subscribe', 'unsubscribe']);
        if (!allowed.has(action))
            failCode('SATURN_PERMISSION',{role:'environment-action'},{action},{status:403});
        const link = this.link(sessionId);
        const url = new URL(action, link.api);
        if (init.query)
            url.search = init.query.toString();
        const response = await fetch(url, {
            method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
            headers: {
                Authorization: `Bearer ${link.token}`,
                ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            body: init.body === undefined ? undefined : JSON.stringify(init.body),
            signal: AbortSignal.timeout(action === 'report' ? 20000 : 15000),
            cache: 'no-store',
            redirect: 'error',
        });
        return response;
    }

    async stream(sessionId: string): Promise<Response> {
        const link = this.link(sessionId);
        return fetch(new URL('stream', link.api), {
            headers: { Authorization: `Bearer ${link.token}` },
            cache: 'no-store',
            redirect: 'error',
        });
    }
}
