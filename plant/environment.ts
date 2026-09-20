import { AppError, type Actor, type Frame } from './types';

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
        throw new AppError('Invalid environment name');
    return value.trim();
};

const apiBase = (value: unknown): URL => {
    if (typeof value !== 'string' || value.length > 2048)
        throw new AppError('Invalid environment URL');
    const input = new URL(value);
    if (!['http:', 'https:'].includes(input.protocol) || input.username || input.password || input.hash)
        throw new AppError('Environment URL must be HTTP(S) without credentials or fragments');
    // A Saturn installation is addressed by origin. Paths are deliberately not trusted.
    return new URL('/plant/api/', input.origin);
};

async function responseJson<T>(response: Response): Promise<T> {
    const value = await response.json().catch(() => null) as any;
    if (!response.ok)
        throw new AppError(value?.error ?? `Remote Saturn returned HTTP ${response.status}`, response.status >= 400 && response.status < 600 ? response.status : 502);
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
            throw new AppError('Invalid remote credentials');

        const login = await fetch(new URL('login', api), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: input.user, password: input.password, mode: 'bearer' }),
            signal: AbortSignal.timeout(10000),
            redirect: 'error',
        });
        const authenticated = await responseJson<{token: string; actor: Actor}>(login);
        if (!/^[A-Za-z0-9_-]{43}$/.test(authenticated.token))
            throw new AppError('Remote Saturn returned an invalid session token', 502);

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
            throw new AppError('No live environment is connected', 409);
        return link;
    }

    async request(sessionId: string, action: string, init: {
        method?: 'GET' | 'POST';
        query?: URLSearchParams;
        body?: unknown;
    } = {}): Promise<Response> {
        const allowed = new Set(['session', 'instance', 'events', 'reports', 'history', 'report', 'command', 'restart', 'firmware', 'subscribe', 'unsubscribe']);
        if (!allowed.has(action))
            throw new AppError('Environment action is not allowed', 403);
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
