import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { authenticateEdge, completeCommand, leaseCommands, storeEdgeState } from './_lib/state.js';

const server = createServer((_request, response) => {
    response.writeHead(426, {
        'Content-Type': 'application/json; charset=utf-8',
        Upgrade: 'websocket',
        'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify({ error: 'WebSocket upgrade required' }));
});

const wss = new WebSocketServer({
    server,
    maxPayload: 2_500_000,
    perMessageDeflate: false,
});

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function send(socket: WebSocket, value: unknown): void {
    if (socket.readyState === socket.OPEN)
        socket.send(JSON.stringify(value));
}

async function deliver(socket: WebSocket, siteId: string): Promise<void> {
    for (const command of await leaseCommands(siteId)) {
        send(socket, {
            type: 'command',
            cloudId: command.cloudId,
            payload: command.payload,
            actor: command.actor,
        });
    }
}

wss.on('connection', socket => {
    let siteId: string | null = null;
    let queue = Promise.resolve();

    const processMessage = async (data: Buffer): Promise<void> => {
        if (data.byteLength > 2_500_000) {
            socket.close(1009, 'Message too large');
            return;
        }
        let parsed: unknown;
        try { parsed = JSON.parse(data.toString('utf8')); }
        catch {
            socket.close(1007, 'Malformed JSON');
            return;
        }
        const message = record(parsed);
        if (!message || typeof message.type !== 'string') {
            socket.close(1008, 'Invalid Edge message');
            return;
        }

        if (!siteId) {
            if (message.type !== 'hello' || typeof message.site !== 'string' || typeof message.token !== 'string') {
                socket.close(1008, 'hello required');
                return;
            }
            const instance = record(message.instance);
            const project = record(message.project);
            const frame = record(message.frame);
            if (!instance || !project || !frame) {
                socket.close(1008, 'Invalid hello state');
                return;
            }
            const site = await authenticateEdge(message.site, message.token);
            siteId = site.id;
            await storeEdgeState(site.id, instance, frame, project);
            send(socket, { type: 'ready', site: site.slug });
            await deliver(socket, site.id);
            return;
        }

        if (message.type === 'frame') {
            const frame = record(message.frame);
            if (!frame) {
                socket.close(1008, 'Invalid frame');
                return;
            }
            await storeEdgeState(siteId, undefined, frame);
            await deliver(socket, siteId);
            return;
        }

        if (message.type === 'heartbeat') {
            const instance = record(message.instance);
            const project = message.project === undefined ? undefined : record(message.project);
            if (!instance || (message.project !== undefined && !project)) {
                socket.close(1008, 'Invalid heartbeat');
                return;
            }
            await storeEdgeState(siteId, instance, undefined, project ?? undefined);
            await deliver(socket, siteId);
            return;
        }

        if (message.type === 'receipt' && typeof message.cloudId === 'string' && typeof message.ok === 'boolean') {
            await completeCommand(
                siteId,
                message.cloudId,
                message.ok,
                message.receipt,
                typeof message.error === 'string' ? message.error : undefined,
            );
            await deliver(socket, siteId);
            return;
        }

        socket.close(1008, 'Unsupported Edge message');
    };

    socket.on('message', raw => {
        const data = Buffer.isBuffer(raw)
            ? raw
            : Array.isArray(raw)
                ? Buffer.concat(raw)
                : Buffer.from(raw);
        queue = queue
            .then(() => processMessage(data))
            .catch(error => {
                console.error('Saturn Edge message failed', error);
                socket.close(1011, 'Edge processing failed');
            });
    });
});

export default server;
