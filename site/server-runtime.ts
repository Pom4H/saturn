import type { Actor, Frame, Project, Revision } from '../plant/types';

export interface ServerSession {
  actor: Actor;
  mode: 'simulation';
  project: Project;
  frame: Frame;
  head: string | null;
  desired: string | null;
  healthy: boolean;
  releaseError: string;
  overrides: Record<string, number>;
  csrf: string;
}

class HttpResponseError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'HttpResponseError';
  }
}

async function json<T>(response: Response): Promise<T> {
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpResponseError(response.status, typeof value?.error === 'string' ? value.error : `HTTP ${response.status}`);
  return value as T;
}

export async function fetchServerSession(): Promise<ServerSession> {
  const response = await fetch('/plant/api/session', {
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(12000),
  });
  if (response.status === 401 || response.status === 403) throw new Error('Войдите на сервер, затем повторите подключение.');
  const session = await json<ServerSession>(response);
  if (!session || session.mode !== 'simulation' || !session.actor || !session.project || !session.frame || typeof session.csrf !== 'string') {
    throw new Error('Неверный ответ сервера');
  }
  return session;
}

export async function serverPost<T>(session: ServerSession, action: string, input: unknown, options: { retryTransport?: boolean } = {}): Promise<T> {
  const delays = options.retryTransport ? [0, 900, 2200] : [0];
  let last: unknown;
  for (const delay of delays) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    try {
      const response = await fetch(`/plant/api/${action}`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(15000),
      });
      return await json<T>(response);
    } catch (error) {
      last = error;
      // A completed HTTP response is authoritative, even when it is an error.
      // Retry only failures where no response arrived (timeout/network/redirect).
      if (error instanceof HttpResponseError) throw error;
    }
  }
  throw last instanceof Error ? last : new Error('Network request failed');
}

export function commandPayload(session: ServerSession, action: string, extra: Record<string, unknown> = {}) {
  return {
    id: `cmd-${crypto.randomUUID()}`,
    revision: session.frame.revision,
    runId: session.frame.runId,
    action,
    ...extra,
  };
}

export type { Revision };
