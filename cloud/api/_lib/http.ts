import type { IncomingMessage, ServerResponse } from 'node:http';

export async function readJson(request: IncomingMessage, limit = 262_144): Promise<Record<string, unknown>> {
    const contentType = request.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().startsWith('application/json'))
        throw httpError(415, 'application/json required');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += value.byteLength;
        if (size > limit)
            throw httpError(413, 'Request body too large');
        chunks.push(value);
    }
    let parsed: unknown;
    try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw httpError(400, 'Malformed JSON'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw httpError(400, 'JSON object required');
    return parsed as Record<string, unknown>;
}

export interface HttpError extends Error { status: number }

export function httpError(status: number, message: string): HttpError {
    return Object.assign(new Error(message), { status });
}

export function sendJson(response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...headers,
    });
    response.end(JSON.stringify(value));
}

export function sendError(response: ServerResponse, error: unknown): void {
    const status = error instanceof Error && 'status' in error && typeof (error as { status?: unknown }).status === 'number'
        ? (error as { status: number }).status : 500;
    if (status === 500) console.error(error);
    sendJson(response, status, { error: status === 500 ? 'Internal server error' : error instanceof Error ? error.message : 'Request failed' });
}

export function requestUrl(request: IncomingMessage): URL {
    const host = request.headers['x-forwarded-host'] ?? request.headers.host ?? 'localhost';
    const value = Array.isArray(host) ? host[0] : host;
    const protocol = request.headers['x-forwarded-proto'] ?? 'https';
    const scheme = Array.isArray(protocol) ? protocol[0] : protocol;
    return new URL(request.url ?? '/', `${scheme}://${value}`);
}
