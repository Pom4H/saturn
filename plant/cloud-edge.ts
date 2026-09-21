import type { Actor, Frame } from './types';
import type { Service } from './service';

export interface CloudEdgeOptions {
    url: string;
    site: string;
    token: string;
    sampleIntervalMs?: number;
    heartbeatIntervalMs?: number;
}

interface CloudCommandPayload {
    id: string;
    revision: string;
    action: string;
    runId?: string;
    target?: string;
    parameter?: string;
    value?: number;
}

interface CloudCommandMessage {
    type: 'command';
    cloudId: string;
    payload: CloudCommandPayload;
    actor: Actor;
}

type EdgeMessage =
    | { type: 'hello'; site: string; token: string; instance: Record<string, unknown>; project: unknown; frame: Frame }
    | { type: 'frame'; frame: Frame }
    | { type: 'heartbeat'; instance: Record<string, unknown>; project?: unknown }
    | { type: 'receipt'; cloudId: string; ok: true; receipt: unknown }
    | { type: 'receipt'; cloudId: string; ok: false; error: string };

const record = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

function commandMessage(value: unknown): CloudCommandMessage | null {
    if (!record(value) || value.type !== 'command' || typeof value.cloudId !== 'string' || !record(value.payload) || !record(value.actor))
        return null;
    const payload = value.payload;
    const actor = value.actor;
    if (typeof payload.id !== 'string' || typeof payload.revision !== 'string' || typeof payload.action !== 'string')
        return null;
    if (typeof actor.id !== 'string' || !['operator', 'engineer'].includes(String(actor.role)))
        return null;
    const result: CloudCommandPayload = {
        id: payload.id,
        revision: payload.revision,
        action: payload.action,
    };
    if (typeof payload.runId === 'string') result.runId = payload.runId;
    if (typeof payload.target === 'string') result.target = payload.target;
    if (typeof payload.parameter === 'string') result.parameter = payload.parameter;
    if (typeof payload.value === 'number') result.value = payload.value;
    return {
        type: 'command',
        cloudId: value.cloudId,
        payload: result,
        actor: { id: actor.id, role: actor.role as Actor['role'] },
    };
}

function endpoint(options: CloudEdgeOptions): string {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(options.site))
        throw new Error('SATURN_CLOUD_SITE must be a DNS-safe site slug');
    if (options.token.length < 32 || options.token.length > 512)
        throw new Error('SATURN_CLOUD_TOKEN is invalid');
    const url = new URL(options.url);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash)
        throw new Error('SATURN_CLOUD_URL must be an HTTP(S) or WS(S) origin');
    url.protocol = url.protocol === 'http:' || url.protocol === 'ws:' ? 'ws:' : 'wss:';
    url.pathname = '/api/edge';
    url.search = '';
    return url.toString();
}

const cloudActor: Actor = { id: 'cloud-edge', role: 'viewer' };

/**
 * Optional outbound bridge from an authoritative local Saturn runtime to Saturn Cloud.
 *
 * Cloud never becomes the plant runtime authority. The bridge only mirrors project/runtime
 * state and forwards authenticated commands back through Service.command(), so revision/run
 * checks and fail-closed behavior remain exactly the same as local operator commands.
 */
export class CloudEdge {
    private socket: WebSocket | null = null;
    private stopped = true;
    private reconnectMs = 1000;
    private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    private sampleTimer: ReturnType<typeof setInterval> | undefined;
    private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    private unsubscribe: (() => void) | undefined;
    private latestFrame: Frame | null = null;
    private sentSeq = -1;
    private sentRevision = '';

    constructor(private readonly service: Service, private readonly options: CloudEdgeOptions) {}

    start(): void {
        if (!this.stopped) return;
        this.stopped = false;
        this.unsubscribe = this.service.subscribe(frame => { this.latestFrame = frame; });
        this.latestFrame = this.service.frame();
        this.sampleTimer = setInterval(
            () => this.flushFrame(),
            Math.max(250, this.options.sampleIntervalMs ?? 1000),
        );
        this.heartbeatTimer = setInterval(
            () => void this.heartbeat(),
            Math.max(2000, this.options.heartbeatIntervalMs ?? 5000),
        );
        this.connect();
    }

    stop(): void {
        if (this.stopped) return;
        this.stopped = true;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (this.sampleTimer) clearInterval(this.sampleTimer);
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        const socket = this.socket;
        this.socket = null;
        if (socket && socket.readyState < WebSocket.CLOSING)
            socket.close(1000, 'Saturn runtime stopping');
    }

    private connect(): void {
        if (this.stopped) return;
        let socket: WebSocket;
        try { socket = new WebSocket(endpoint(this.options)); }
        catch {
            this.scheduleReconnect();
            return;
        }
        this.socket = socket;
        socket.addEventListener('open', () => {
            if (this.socket !== socket || this.stopped) return;
            this.reconnectMs = 1000;
            void this.hello();
        });
        socket.addEventListener('message', event => {
            if (this.socket !== socket || typeof event.data !== 'string') return;
            let parsed: unknown;
            try { parsed = JSON.parse(event.data); }
            catch { return; }
            const command = commandMessage(parsed);
            if (command) void this.execute(command);
        });
        socket.addEventListener('close', () => {
            if (this.socket === socket) this.socket = null;
            if (!this.stopped) this.scheduleReconnect();
        });
        socket.addEventListener('error', () => {
            if (socket.readyState < WebSocket.CLOSING) socket.close();
        });
    }

    private scheduleReconnect(): void {
        if (this.stopped || this.reconnectTimer) return;
        const delay = this.reconnectMs;
        this.reconnectMs = Math.min(this.reconnectMs * 2, 30_000);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            this.connect();
        }, delay);
    }

    private send(message: EdgeMessage): boolean {
        const socket = this.socket;
        if (!socket || socket.readyState !== WebSocket.OPEN) return false;
        try {
            socket.send(JSON.stringify(message));
            return true;
        }
        catch {
            socket.close();
            return false;
        }
    }

    private async instance(): Promise<Record<string, unknown>> {
        const { actor: _actor, ...instance } = await this.service.instance(cloudActor);
        return instance;
    }

    private async hello(): Promise<void> {
        const frame = this.latestFrame ?? this.service.frame();
        const instance = await this.instance();
        if (this.send({
            type: 'hello',
            site: this.options.site,
            token: this.options.token,
            instance,
            project: this.service.project,
            frame,
        })) {
            this.sentSeq = frame.seq;
            this.sentRevision = frame.revision;
        }
    }

    private flushFrame(): void {
        const frame = this.latestFrame;
        if (!frame || frame.seq === this.sentSeq) return;
        if (this.send({ type: 'frame', frame })) {
            this.sentSeq = frame.seq;
            this.sentRevision = frame.revision;
        }
    }

    private async heartbeat(): Promise<void> {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        const instance = await this.instance();
        const revision = typeof instance.applied === 'string' ? instance.applied : '';
        this.send({
            type: 'heartbeat',
            instance,
            ...(revision && revision !== this.sentRevision ? { project: this.service.project } : {}),
        });
        if (revision) this.sentRevision = revision;
    }

    private async execute(command: CloudCommandMessage): Promise<void> {
        try {
            const receipt = this.service.command(command.payload, command.actor);
            this.send({ type: 'receipt', cloudId: command.cloudId, ok: true, receipt });
        }
        catch (error) {
            this.send({
                type: 'receipt',
                cloudId: command.cloudId,
                ok: false,
                error: error instanceof Error ? error.message : 'Command rejected',
            });
        }
    }
}
