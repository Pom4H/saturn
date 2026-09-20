import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { BunSql } from '../adapters/bun-sql';
import { Store } from '../store';
import { startPlantServer } from '../bun-server';

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

console.log('Bun server smoke: SQLite, auth, origin guard and WebSocket live stream OK');
