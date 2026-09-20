import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { BunSql } from '../adapters/bun-sql';
import { Store } from '../store';
import { startPlantServer } from '../bun-server';
import { runReport } from '../adapters/bun-reports';
import { ModbusTcpClient } from '../adapters/modbus-tcp';
import type { ReportTask } from '../types';

const sql = new BunSql(':memory:');
const portableStore = new Store(sql);
portableStore.set('bun-smoke', { ok: true });
assert.deepEqual(portableStore.meta('bun-smoke', null), { ok: true });
sql.transaction(() => {
    portableStore.set('tx-a', 1);
    portableStore.set('tx-b', 2);
});
assert.equal(portableStore.meta('tx-a', 0), 1);
assert.equal(portableStore.meta('tx-b', 0), 2);
sql.close();

const reportTask: ReportTask = {
    id: 'bun-report-smoke',
    report: {
        id: 'summary',
        title: 'Summary',
        on: { workflow_dispatch: {} },
        signals: ['flow'],
        sql: 'SELECT AVG(value) AS average FROM samples WHERE quality = \'good\'',
        window: 1000,
        columns: [{ key: 'average', title: 'Average' }],
        notify: false,
    },
    revision: 'smoke',
    runId: 'smoke',
    trigger: 'workflow_dispatch',
    actor: 'bun-smoke',
    createdAt: 0,
    from: 0,
    to: 1000,
    inputs: {},
    data: {
        samples: [
            { signal: 'flow', time: 0, value: 10, quality: 'good' },
            { signal: 'flow', time: 1000, value: 20, quality: 'good' },
        ],
        segments: [],
    },
};
const report = await runReport(reportTask);
assert.equal(report.rows[0].average, 15);
assert.match(report.html, /Summary/);

const u16 = (buffer: Uint8Array, offset: number) => (buffer[offset] << 8) | buffer[offset + 1];
const put16 = (buffer: Uint8Array, offset: number, value: number) => {
    buffer[offset] = (value >>> 8) & 0xff;
    buffer[offset + 1] = value & 0xff;
};
interface SmokeTcpSocket { write(data: Uint8Array): number }
interface SmokeTcpServer { port: number; stop(closeActiveConnections?: boolean): void }
interface SmokeBunRuntime {
    listen(options: {
        hostname: string;
        port: number;
        socket: { data(socket: SmokeTcpSocket, data: Uint8Array): void };
    }): SmokeTcpServer;
}
const native = (globalThis as typeof globalThis & { Bun?: SmokeBunRuntime }).Bun;
assert.ok(native, 'Bun runtime is required for native smoke tests');
const registers = [123, 456, 789];
const modbusServer = native.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
        data(socket, request) {
            assert.equal(u16(request, 2), 0);
            const unit = request[6], fn = request[7], address = u16(request, 8);
            if (fn === 3 || fn === 4) {
                const count = u16(request, 10);
                const response = new Uint8Array(9 + count * 2);
                response.set(request.subarray(0, 4), 0);
                put16(response, 4, 3 + count * 2);
                response[6] = unit;
                response[7] = fn;
                response[8] = count * 2;
                for (let i = 0; i < count; i++) put16(response, 9 + i * 2, registers[address + i] ?? 0);
                socket.write(response);
                return;
            }
            if (fn === 6) {
                registers[address] = u16(request, 10);
                socket.write(request.slice(0, 12));
                return;
            }
            const response = new Uint8Array(9);
            response.set(request.subarray(0, 4), 0);
            put16(response, 4, 3);
            response[6] = unit;
            response[7] = fn | 0x80;
            response[8] = 1;
            socket.write(response);
        },
    },
});
const modbus = new ModbusTcpClient({ host: '127.0.0.1', port: modbusServer.port, timeoutMs: 1000 });
try {
    assert.deepEqual(await modbus.readHoldingRegisters(0, 2), [123, 456]);
    assert.deepEqual(await modbus.readInputRegisters(2, 1), [789]);
    await modbus.writeSingleRegister(1, 321);
    assert.deepEqual(await modbus.readHoldingRegisters(1, 1), [321]);
} finally {
    modbus.close();
    modbusServer.stop(true);
}

const dir = await mkdtemp(join(tmpdir(), 'saturn-bun-'));
const password = 'saturn-bun-smoke-2026';
const app = await startPlantServer({
    host: '127.0.0.1',
    port: 0,
    data: join(dir, 'plant.sqlite3'),
    repository: join(dir, 'project.git'),
    root: resolve('dist/plant'),
    user: 'bun-smoke',
    password,
    autoTick: false,
});

interface BunWebSocketConstructor {
    new (url: string, options?: { headers?: Record<string, string> }): WebSocket;
}
const BunWebSocket = WebSocket as unknown as BunWebSocketConstructor;

try {
    const health = await fetch(app.origin + '/plant/api/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok', mode: 'simulation', runtime: 'bun', releaseError: false });

    const login = await fetch(app.origin + '/plant/api/login', {
        method: 'POST',
        headers: { Origin: app.origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: 'bun-smoke', password }),
    });
    assert.equal(login.status, 200, await login.clone().text());
    const loginBody = await login.json() as { csrf: string; actor: { id: string; role: string } };
    assert.equal(loginBody.actor.id, 'bun-smoke');
    assert.equal(loginBody.actor.role, 'engineer');
    assert.ok(loginBody.csrf.length > 20);

    const setCookie = login.headers.get('set-cookie');
    assert.ok(setCookie);
    const cookie = setCookie.split(';', 1)[0];

    const session = await fetch(app.origin + '/plant/api/session', { headers: { Cookie: cookie } });
    assert.equal(session.status, 200, await session.clone().text());
    const sessionBody = await session.json() as { transport: { sse: boolean; websocket: boolean } };
    assert.deepEqual(sessionBody.transport, { sse: true, websocket: true });

    const denied = await fetch(app.origin + '/plant/api/restart', {
        method: 'POST',
        headers: { Cookie: cookie, Origin: 'https://untrusted.example', 'Content-Type': 'application/json', 'X-CSRF-Token': loginBody.csrf },
        body: '{}',
    });
    assert.equal(denied.status, 403);

    const wsUrl = app.origin.replace(/^http/, 'ws') + '/plant/api/ws';
    const socket = new BunWebSocket(wsUrl, { headers: { Cookie: cookie, Origin: app.origin } });
    const firstMessage = await new Promise<string>((accept, reject) => {
        const timer = setTimeout(() => reject(new Error('WebSocket smoke timeout')), 3000);
        socket.addEventListener('message', event => {
            clearTimeout(timer);
            accept(String(event.data));
        }, { once: true });
        socket.addEventListener('error', () => {
            clearTimeout(timer);
            reject(new Error('WebSocket smoke failed'));
        }, { once: true });
    });
    const live = JSON.parse(firstMessage) as { type: string; frame?: { runId?: string } };
    assert.equal(live.type, 'frame');
    assert.equal(typeof live.frame?.runId, 'string');
    socket.close();
} finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
}

console.log('Bun server smoke: SQLite, report isolation, Modbus TCP, auth, origin guard and WebSocket live stream OK');
