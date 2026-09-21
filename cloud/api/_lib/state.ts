import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { sql, type DbRecord } from './db.js';
import { hashSecret, newPassword, newToken, safeSecretEqual, tokenHash, verifySecret } from './security.js';
import { httpError } from './http.js';

export type Role = 'viewer' | 'operator' | 'engineer';
export interface Actor { id: string; role: Role }

export interface Site {
    id: string;
    slug: string;
    name: string;
    edgeTokenHash: string;
    operatorPasswordHash: string;
    engineerPasswordHash: string;
    instance: Record<string, unknown> | null;
    project: Record<string, unknown> | null;
    frame: Record<string, unknown> | null;
    lastSeen: Date | null;
    createdAt: Date;
}

export interface Session {
    actor: Actor;
    csrf: string;
    bearer: boolean;
    token: string;
    expiresAt: Date;
}

const onlineWindowMs = 15_000;

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringField(row: DbRecord, name: string): string {
    const value = row[name];
    if (typeof value !== 'string') throw new Error(`Database field ${name} is invalid`);
    return value;
}

function dateField(value: unknown): Date | null {
    if (value === null || value === undefined) return null;
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isFinite(date.getTime()) ? date : null;
}

function siteFromRow(row: DbRecord): Site {
    return {
        id: stringField(row, 'id'),
        slug: stringField(row, 'slug'),
        name: stringField(row, 'name'),
        edgeTokenHash: stringField(row, 'edge_token_hash'),
        operatorPasswordHash: stringField(row, 'operator_password_hash'),
        engineerPasswordHash: stringField(row, 'engineer_password_hash'),
        instance: record(row.instance),
        project: record(row.project),
        frame: record(row.frame),
        lastSeen: dateField(row.last_seen),
        createdAt: dateField(row.created_at) ?? new Date(0),
    };
}

export function siteIsOnline(site: Site, now = Date.now()): boolean {
    return !!site.lastSeen && now - site.lastSeen.getTime() <= onlineWindowMs;
}

export function siteSlugFromRequest(request: IncomingMessage): string {
    const forwarded = request.headers['x-forwarded-host'] ?? request.headers.host ?? '';
    const hostValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const host = hostValue.toLowerCase().split(':')[0].replace(/\.$/, '');
    const root = (process.env.SATURN_CLOUD_ROOT_DOMAIN ?? '').toLowerCase().replace(/^\.+|\.+$/g, '');
    if (root) {
        if (!host.endsWith('.' + root))
            throw httpError(404, 'Unknown Saturn Cloud site');
        const slug = host.slice(0, -(root.length + 1));
        if (!slug || slug.includes('.'))
            throw httpError(404, 'Unknown Saturn Cloud site');
        return slug;
    }
    const developmentSite = request.headers['x-saturn-site'];
    const slug = Array.isArray(developmentSite) ? developmentSite[0] : developmentSite;
    if (typeof slug !== 'string' || !slug)
        throw httpError(500, 'SATURN_CLOUD_ROOT_DOMAIN is required');
    return slug.toLowerCase();
}

export async function siteBySlug(slug: string): Promise<Site | null> {
    const rows = await sql`SELECT * FROM sites WHERE slug=${slug} LIMIT 1` as unknown as DbRecord[];
    return rows[0] ? siteFromRow(rows[0]) : null;
}

export async function siteById(id: string): Promise<Site | null> {
    const rows = await sql`SELECT * FROM sites WHERE id=${id}::uuid LIMIT 1` as unknown as DbRecord[];
    return rows[0] ? siteFromRow(rows[0]) : null;
}

export async function listSites(): Promise<Array<Pick<Site, 'id' | 'slug' | 'name' | 'lastSeen' | 'createdAt'>>> {
    const rows = await sql`SELECT id,slug,name,last_seen,created_at FROM sites ORDER BY created_at DESC` as unknown as DbRecord[];
    return rows.map(row => ({
        id: stringField(row, 'id'),
        slug: stringField(row, 'slug'),
        name: stringField(row, 'name'),
        lastSeen: dateField(row.last_seen),
        createdAt: dateField(row.created_at) ?? new Date(0),
    }));
}

export function requireAdmin(request: IncomingMessage): void {
    const expected = process.env.SATURN_CLOUD_ADMIN_TOKEN;
    if (!expected || expected.length < 32)
        throw httpError(503, 'Saturn Cloud admin token is not configured');
    const header = request.headers.authorization ?? '';
    const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!supplied || !safeSecretEqual(supplied, expected))
        throw httpError(401, 'Admin authentication required');
}

export async function createSite(input: Record<string, unknown>): Promise<{
    site: Site;
    edgeToken: string;
    operatorPassword: string;
    engineerPassword: string;
}> {
    const slug = typeof input.slug === 'string' ? input.slug.trim().toLowerCase() : '';
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug))
        throw httpError(400, 'Site slug must be DNS-safe');
    if (!name || name.length > 120)
        throw httpError(400, 'Site name is required');
    const edgeToken = newToken();
    const operatorPassword = newPassword();
    const engineerPassword = newPassword();
    const id = randomUUID();
    try {
        await sql`
            INSERT INTO sites(id,slug,name,edge_token_hash,operator_password_hash,engineer_password_hash)
            VALUES(
                ${id}::uuid,${slug},${name},${hashSecret(edgeToken)},
                ${hashSecret(operatorPassword)},${hashSecret(engineerPassword)}
            )
        `;
    }
    catch (error) {
        if (error instanceof Error && /unique|duplicate/i.test(error.message))
            throw httpError(409, 'Site slug already exists');
        throw error;
    }
    const site = await siteById(id);
    if (!site) throw new Error('Created site could not be loaded');
    return { site, edgeToken, operatorPassword, engineerPassword };
}

export async function authenticateEdge(siteSlug: string, token: string): Promise<Site> {
    const site = await siteBySlug(siteSlug);
    if (!site || !verifySecret(token, site.edgeTokenHash))
        throw httpError(401, 'Invalid edge credentials');
    return site;
}

export async function login(site: Site, user: string, password: string, bearer: boolean): Promise<Session> {
    let role: Role;
    let expected: string;
    if (user === 'engineer') {
        role = 'engineer';
        expected = site.engineerPasswordHash;
    }
    else if (user === 'operator') {
        role = 'operator';
        expected = site.operatorPasswordHash;
    }
    else {
        throw httpError(401, 'Invalid credentials');
    }
    if (!verifySecret(password, expected))
        throw httpError(401, 'Invalid credentials');
    const token = newToken();
    const csrf = newToken();
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    await sql`
        INSERT INTO sessions(token_hash,site_id,actor_id,role,csrf,expires_at)
        VALUES(${tokenHash(token)},${site.id}::uuid,${user},${role},${csrf},${expiresAt.toISOString()}::timestamptz)
    `;
    return { actor: { id: user, role }, csrf, bearer, token, expiresAt };
}

function cookieValue(request: IncomingMessage, name: string): string {
    const source = request.headers.cookie ?? '';
    for (const part of source.split(';')) {
        const [key, ...rest] = part.trim().split('=');
        if (key === name) return decodeURIComponent(rest.join('='));
    }
    return '';
}

export async function authenticateSession(request: IncomingMessage, site: Site): Promise<Session> {
    const authorization = request.headers.authorization ?? '';
    const bearer = authorization.startsWith('Bearer ');
    const token = bearer ? authorization.slice(7) : cookieValue(request, 'saturn_cloud_session');
    if (!token) throw httpError(401, 'Authentication required');
    const rows = await sql`
        SELECT actor_id,role,csrf,expires_at
        FROM sessions
        WHERE token_hash=${tokenHash(token)}
          AND site_id=${site.id}::uuid
          AND expires_at > now()
        LIMIT 1
    ` as unknown as DbRecord[];
    const row = rows[0];
    if (!row) throw httpError(401, 'Session expired');
    const role = row.role;
    if (role !== 'viewer' && role !== 'operator' && role !== 'engineer')
        throw new Error('Database session role is invalid');
    return {
        actor: { id: stringField(row, 'actor_id'), role },
        csrf: stringField(row, 'csrf'),
        bearer,
        token,
        expiresAt: dateField(row.expires_at) ?? new Date(0),
    };
}

export async function logout(session: Session): Promise<void> {
    await sql`DELETE FROM sessions WHERE token_hash=${tokenHash(session.token)}`;
}

const roleRank: Record<Role, number> = { viewer: 0, operator: 1, engineer: 2 };
export function requireRole(actor: Actor, role: Role): void {
    if (roleRank[actor.role] < roleRank[role])
        throw httpError(403, `${role} role required`);
}

export function requireCsrf(request: IncomingMessage, session: Session): void {
    if (session.bearer) return;
    if (request.headers['x-csrf-token'] !== session.csrf)
        throw httpError(403, 'Invalid CSRF token');
}

interface SampleRow {
    signal: string;
    time: number;
    value: number | null;
    quality: string;
}

function sampleRows(frame: Record<string, unknown>): { runId: string; rows: SampleRow[] } {
    const runId = typeof frame.runId === 'string' ? frame.runId : '';
    const samples = record(frame.samples);
    if (!runId || !samples) return { runId, rows: [] };
    const rows: SampleRow[] = [];
    for (const [signal, raw] of Object.entries(samples)) {
        const sample = record(raw);
        if (!sample) continue;
        const time = sample.time;
        const value = sample.value;
        const quality = sample.quality;
        if (typeof time !== 'number' || !Number.isFinite(time) ||
            !(value === null || (typeof value === 'number' && Number.isFinite(value))) ||
            !['good','bad','stale','offline'].includes(String(quality)))
            continue;
        rows.push({ signal, time, value: value as number | null, quality: String(quality) });
    }
    return { runId, rows };
}

export async function storeEdgeState(siteId: string, instance?: Record<string, unknown>, frame?: Record<string, unknown>, project?: Record<string, unknown>): Promise<void> {
    const instanceJson = instance ? JSON.stringify(instance) : null;
    const projectJson = project ? JSON.stringify(project) : null;
    const frameJson = frame ? JSON.stringify(frame) : null;
    await sql`
        UPDATE sites
        SET instance=COALESCE(${instanceJson}::jsonb,instance),
            project=COALESCE(${projectJson}::jsonb,project),
            frame=COALESCE(${frameJson}::jsonb,frame),
            last_seen=now()
        WHERE id=${siteId}::uuid
    `;
    if (!frame) return;
    const { runId, rows } = sampleRows(frame);
    if (!runId || !rows.length) return;
    await sql`
        INSERT INTO samples(site_id,run_id,signal,time,value,quality)
        SELECT ${siteId}::uuid,${runId},x.signal,x.time,x.value,x.quality
        FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
            AS x(signal text,time bigint,value double precision,quality text)
        ON CONFLICT(site_id,run_id,signal,time)
        DO UPDATE SET value=excluded.value,quality=excluded.quality
    `;
}

function staleFrame(frame: Record<string, unknown> | null, online: boolean): Record<string, unknown> | null {
    if (!frame || online) return frame;
    const samples = record(frame.samples);
    if (!samples) return { ...frame };
    const stale: Record<string, unknown> = {};
    for (const [name, raw] of Object.entries(samples)) {
        const sample = record(raw);
        stale[name] = sample ? { ...sample, quality: 'stale' } : raw;
    }
    return { ...frame, samples: stale };
}

export function publicInstance(site: Site): Record<string, unknown> {
    const online = siteIsOnline(site);
    const instance = site.instance ?? {};
    return {
        ...instance,
        protocol: 1,
        authority: 'runtime',
        projectId: typeof instance.projectId === 'string' ? instance.projectId : site.project?.id ?? site.slug,
        healthy: online && instance.healthy !== false,
        online,
        cloudSite: site.slug,
    };
}

export function sessionState(site: Site, actor: Actor): Record<string, unknown> {
    const instance = publicInstance(site);
    return {
        actor,
        mode: 'cloud',
        project: site.project,
        frame: staleFrame(site.frame, siteIsOnline(site)),
        head: instance.head ?? null,
        desired: instance.published ?? null,
        healthy: instance.healthy === true,
        releaseError: '',
        overrides: {},
        instance,
        uiMode: 'runtime',
        cloud: { site: site.slug, online: siteIsOnline(site), lastSeen: site.lastSeen?.toISOString() ?? null },
    };
}

export async function history(site: Site, signals: string[], from: number, to: number): Promise<{ samples: SampleRow[]; segments: Array<SampleRow & { start: number; end: number }> }> {
    if (!site.frame) throw httpError(409, 'Site has not sent telemetry yet');
    const runId = typeof site.frame.runId === 'string' ? site.frame.runId : '';
    if (!runId) throw httpError(409, 'Site run is unknown');
    if (!signals.length || signals.length > 64 || !Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > 7 * 86_400_000)
        throw httpError(400, 'Invalid history range');
    const rows = await sql`
        SELECT signal,time,value,quality
        FROM samples
        WHERE site_id=${site.id}::uuid
          AND run_id=${runId}
          AND signal = ANY(${signals}::text[])
          AND time >= ${Math.floor(from)}
          AND time <= ${Math.floor(to)}
        ORDER BY signal,time
        LIMIT 20001
    ` as unknown as DbRecord[];
    if (rows.length > 20_000) throw httpError(413, 'History row budget exceeded');
    const samples: SampleRow[] = rows.map(row => ({
        signal: stringField(row, 'signal'),
        time: Number(row.time),
        value: row.value === null ? null : Number(row.value),
        quality: stringField(row, 'quality'),
    }));
    const segments: Array<SampleRow & { start: number; end: number }> = [];
    for (const signal of signals) {
        const points = samples.filter(sample => sample.signal === signal);
        for (let index = 0; index < points.length; index++) {
            const sample = points[index];
            const start = Math.max(sample.time, from);
            const end = Math.min(points[index + 1]?.time ?? to, to);
            if (end > start) segments.push({ ...sample, start, end });
        }
    }
    return { samples, segments };
}

export async function queueCommand(site: Site, payload: Record<string, unknown>, actor: Actor): Promise<string> {
    requireRole(actor, 'operator');
    if (!siteIsOnline(site)) throw httpError(409, 'Site is offline; commands fail closed');
    const commandId = typeof payload.id === 'string' ? payload.id : '';
    const revision = typeof payload.revision === 'string' ? payload.revision : '';
    const action = typeof payload.action === 'string' ? payload.action : '';
    if (!commandId || !revision || !action) throw httpError(400, 'Command id, revision and action are required');
    const existing = await sql`
        SELECT cloud_id,payload,actor,status
        FROM commands
        WHERE site_id=${site.id}::uuid AND command_id=${commandId}
        LIMIT 1
    ` as unknown as DbRecord[];
    if (existing[0]) {
        if (JSON.stringify(existing[0].payload) !== JSON.stringify(payload) || JSON.stringify(existing[0].actor) !== JSON.stringify(actor))
            throw httpError(409, 'Command id already exists with different payload');
        return stringField(existing[0], 'cloud_id');
    }
    const cloudId = randomUUID();
    await sql`
        INSERT INTO commands(cloud_id,site_id,command_id,payload,actor)
        VALUES(${cloudId}::uuid,${site.id}::uuid,${commandId},${JSON.stringify(payload)}::jsonb,${JSON.stringify(actor)}::jsonb)
    `;
    return cloudId;
}

export async function commandResult(cloudId: string): Promise<{ status: string; receipt: unknown; error: string | null } | null> {
    const rows = await sql`SELECT status,receipt,error FROM commands WHERE cloud_id=${cloudId}::uuid LIMIT 1` as unknown as DbRecord[];
    const row = rows[0];
    if (!row) return null;
    return {
        status: stringField(row, 'status'),
        receipt: row.receipt ?? null,
        error: typeof row.error === 'string' ? row.error : null,
    };
}

export async function waitForCommand(cloudId: string, timeoutMs = 8000): Promise<{ status: string; receipt: unknown; error: string | null }> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const result = await commandResult(cloudId);
        if (!result) throw httpError(404, 'Command not found');
        if (result.status === 'applied' || result.status === 'rejected') return result;
        if (Date.now() >= deadline) return result;
        await new Promise(resolve => setTimeout(resolve, 150));
    }
}

export async function leaseCommands(siteId: string): Promise<Array<{ cloudId: string; payload: Record<string, unknown>; actor: Actor }>> {
    const rows = await sql`
        WITH picked AS (
            SELECT cloud_id
            FROM commands
            WHERE site_id=${siteId}::uuid
              AND (
                  status='queued'
                  OR (status='sent' AND (lease_until IS NULL OR lease_until < now()))
              )
            ORDER BY created_at
            LIMIT 16
            FOR UPDATE SKIP LOCKED
        )
        UPDATE commands AS command
        SET status='sent',
            lease_until=now() + interval '30 seconds',
            attempts=attempts+1,
            updated_at=now()
        FROM picked
        WHERE command.cloud_id=picked.cloud_id
        RETURNING command.cloud_id,command.payload,command.actor
    ` as unknown as DbRecord[];
    return rows.flatMap(row => {
        const payload = record(row.payload);
        const actorValue = record(row.actor);
        const role = actorValue?.role;
        if (!payload || !actorValue || typeof actorValue.id !== 'string' || (role !== 'operator' && role !== 'engineer'))
            return [];
        return [{ cloudId: stringField(row, 'cloud_id'), payload, actor: { id: actorValue.id, role } }];
    });
}

export async function completeCommand(siteId: string, cloudId: string, ok: boolean, receipt: unknown, error?: string): Promise<void> {
    await sql`
        UPDATE commands
        SET status=${ok ? 'applied' : 'rejected'},
            receipt=${receipt === undefined ? null : JSON.stringify(receipt)}::jsonb,
            error=${ok ? null : error ?? 'Command rejected'},
            lease_until=NULL,
            updated_at=now()
        WHERE site_id=${siteId}::uuid AND cloud_id=${cloudId}::uuid
    `;
}
