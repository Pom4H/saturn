interface BunSocketLike {
    write(data: Uint8Array): number;
    terminate(): void;
}
interface BunRuntimeLike {
    connect<T>(options: {
        hostname: string;
        port: number;
        tls?: boolean;
        data: T;
        socket: {
            data(socket: BunSocketLike & { data: T }, data: Uint8Array): void;
            close(socket: BunSocketLike & { data: T }, error?: Error): void;
            error(socket: BunSocketLike & { data: T }, error: Error): void;
            connectError(socket: BunSocketLike & { data: T }, error: Error): void;
            timeout(socket: BunSocketLike & { data: T }): void;
            drain(socket: BunSocketLike & { data: T }): void;
        };
    }): Promise<BunSocketLike & { data: T }>;
}
const runtime = (() => {
    const value = (globalThis as typeof globalThis & { Bun?: BunRuntimeLike }).Bun;
    if (!value) throw new Error('Bun TCP transport requires Bun');
    return value;
})();

export interface BunTcpChannelOptions {
    host: string;
    port: number;
    tls?: boolean;
    timeoutMs?: number;
    maxFrameBytes?: number;
}

interface PendingExchange {
    frameLength(buffer: Uint8Array): number | null;
    resolve(frame: Uint8Array): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
    request: Uint8Array;
    offset: number;
}

/**
 * Persistent, single-flight request/response channel for industrial TCP protocols.
 * Protocol adapters own framing; the channel owns connect/reconnect, bounds and timeout.
 */
export class BunTcpChannel {
    private socket: BunSocketLike | null = null;
    private connecting: Promise<BunSocketLike> | null = null;
    private pending: PendingExchange | null = null;
    private buffered = new Uint8Array(0);
    private closed = false;
    readonly timeoutMs: number;
    readonly maxFrameBytes: number;

    constructor(readonly options: BunTcpChannelOptions) {
        if (!options.host || !Number.isInteger(options.port) || options.port < 1 || options.port > 65535)
            throw new Error('Invalid TCP endpoint');
        this.timeoutMs = options.timeoutMs ?? 3000;
        this.maxFrameBytes = options.maxFrameBytes ?? 64 * 1024;
        if (this.timeoutMs < 1 || this.maxFrameBytes < 8) throw new Error('Invalid TCP transport limits');
    }

    private async connect(): Promise<BunSocketLike> {
        if (this.closed) throw new Error('TCP channel is closed');
        if (this.socket) return this.socket;
        if (this.connecting) return this.connecting;
        const state = { channel: this };
        this.connecting = runtime.connect({
            hostname: this.options.host,
            port: this.options.port,
            tls: this.options.tls,
            data: state,
            socket: {
                data(socket, data) { socket.data.channel.accept(data); },
                close(socket, error) { socket.data.channel.disconnected(error ?? new Error('TCP connection closed')); },
                error(socket, error) { socket.data.channel.disconnected(error); },
                connectError(socket, error) { socket.data.channel.disconnected(error); },
                timeout(socket) { socket.data.channel.disconnected(new Error('TCP connection timed out')); },
                drain(socket) { socket.data.channel.flushWrite(socket); },
            },
        }).then(socket => {
            this.socket = socket;
            return socket;
        }).finally(() => { this.connecting = null; });
        return this.connecting;
    }

    private disconnected(error: Error): void {
        this.socket = null;
        this.connecting = null;
        this.buffered = new Uint8Array(0);
        const pending = this.pending;
        this.pending = null;
        if (pending) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
    }

    private accept(chunk: Uint8Array): void {
        if (chunk.byteLength === 0) return;
        if (!this.pending) {
            this.fail(new Error('Unexpected TCP data without a pending request'));
            return;
        }
        const next = new Uint8Array(this.buffered.byteLength + chunk.byteLength);
        next.set(this.buffered);
        next.set(chunk, this.buffered.byteLength);
        this.buffered = next;
        if (this.buffered.byteLength > this.maxFrameBytes) {
            this.fail(new Error('TCP frame exceeds configured limit'));
            return;
        }
        let expected: number | null;
        try { expected = this.pending.frameLength(this.buffered); }
        catch (error) {
            this.fail(error instanceof Error ? error : new Error(String(error)));
            return;
        }
        if (expected === null) return;
        if (!Number.isInteger(expected) || expected < 1 || expected > this.maxFrameBytes) {
            this.fail(new Error('Protocol returned an invalid frame length'));
            return;
        }
        if (this.buffered.byteLength < expected) return;
        if (this.buffered.byteLength !== expected) {
            this.fail(new Error('Protocol returned trailing bytes for a single-flight exchange'));
            return;
        }
        const pending = this.pending;
        const frame = this.buffered.slice(0, expected);
        this.pending = null;
        this.buffered = new Uint8Array(0);
        clearTimeout(pending.timer);
        pending.resolve(frame);
    }

    private fail(error: Error): void {
        const socket = this.socket;
        this.socket = null;
        try { socket?.terminate(); } catch { /* already closed */ }
        this.disconnected(error);
    }


    private flushWrite(socket: BunSocketLike): void {
        const pending = this.pending;
        if (!pending || pending.offset >= pending.request.byteLength) return;
        try {
            const written = socket.write(pending.request.subarray(pending.offset));
            if (written < 0) {
                this.fail(new Error('TCP socket closed while writing request'));
                return;
            }
            pending.offset += written;
        } catch (error) {
            this.fail(error instanceof Error ? error : new Error(String(error)));
        }
    }

    async exchange(request: Uint8Array, frameLength: (buffer: Uint8Array) => number | null): Promise<Uint8Array> {
        if (this.pending) throw new Error('TCP channel allows one in-flight exchange');
        if (request.byteLength === 0 || request.byteLength > this.maxFrameBytes) throw new Error('Invalid TCP request size');
        const socket = await this.connect();
        return new Promise<Uint8Array>((resolve, reject) => {
            const timer = setTimeout(() => this.fail(new Error(`TCP request timed out after ${this.timeoutMs} ms`)), this.timeoutMs);
            this.pending = { frameLength, resolve, reject, timer, request, offset: 0 };
            this.flushWrite(socket);
        });
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        const socket = this.socket;
        this.socket = null;
        try { socket?.terminate(); } catch { /* already closed */ }
        this.disconnected(new Error('TCP channel closed'));
    }
}
