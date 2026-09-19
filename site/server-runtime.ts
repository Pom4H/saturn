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

async function json<T>(response: Response): Promise<T> {
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof value?.error === 'string' ? value.error : `HTTP ${response.status}`);
  return value as T;
}

export async function fetchServerSession(): Promise<ServerSession> {
  const response = await fetch('/plant/api/session', {
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(12000),
  });
  const session = await json<ServerSession>(response);
  if (!session || session.mode !== 'simulation' || !session.actor || !session.project || !session.frame || typeof session.csrf !== 'string') {
    throw new Error('Неверный ответ сервера');
  }
  return session;
}

export async function serverPost<T>(session: ServerSession, action: string, input: unknown): Promise<T> {
  const response = await fetch(`/plant/api/${action}`, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(15000),
  });
  return json<T>(response);
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
