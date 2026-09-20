import type { Frame } from '../plant/types';
import { t } from './i18n';

export type StreamState = 'connecting' | 'live' | 'stale' | 'offline' | 'auth';
export interface TelemetryUpdate {
  state: StreamState;
  frame: Frame | null;
  message: string;
  lastSeenAt: number | null;
  retryInMs: number;
}

function frame(value: unknown): value is Frame {
  if (!value || typeof value !== 'object') return false;
  const v = value as Frame;
  return v.synthetic === true && typeof v.runId === 'string' && typeof v.revision === 'string' && Number.isSafeInteger(v.seq) && v.seq >= 0 && Number.isFinite(v.time) && typeof v.paused === 'boolean' && !!v.samples && typeof v.samples === 'object' && !Array.isArray(v.samples) && Array.isArray(v.alarms);
}

/**
 * Same-origin authenticated simulation stream.
 *
 * The last confirmed frame is deliberately retained while the transport is
 * reconnecting. Callers must treat every non-live state as non-actionable.
 */
export class SimulationStream {
  private source: EventSource | null = null;
  private generation = 0;
  private watchdog = 0;
  private retry = 0;
  private retryTicker = 0;
  private retryAt = 0;
  private lastSeenAt = 0;
  private current: Frame | null = null;
  private enabled = false;
  private abort: AbortController | null = null;
  private attempt = 0;
  private readonly retrySteps = [1000, 2000, 5000, 10000];

  constructor(private readonly update: (update: TelemetryUpdate) => void) {
    window.addEventListener('online', () => { if (this.enabled) this.connect(true); });
    window.addEventListener('offline', () => {
      if (!this.enabled) return;
      this.disconnectTransport();
      this.publish(this.current ? 'stale' : 'offline', t('network.offline'));
    });
    window.addEventListener('pagehide', () => this.disconnectTransport());
    window.addEventListener('pageshow', event => { if (event.persisted && this.enabled) this.connect(true); });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.enabled && this.source === null && navigator.onLine) this.connect(true);
    });
  }

  start(initial?: Frame | null) {
    if (initial && frame(initial)) {
      this.current = initial;
      this.lastSeenAt = Date.now();
    }
    if (this.enabled) return;
    this.enabled = true;
    this.attempt = 0;
    this.connect(true);
  }

  stop() {
    this.enabled = false;
    this.disconnectTransport();
    this.current = null;
    this.lastSeenAt = 0;
    this.attempt = 0;
  }

  private publish(state: StreamState, message: string, retryInMs = 0) {
    this.update({
      state,
      frame: this.current,
      message,
      lastSeenAt: this.lastSeenAt || null,
      retryInMs: Math.max(0, retryInMs),
    });
  }

  private disconnectTransport() {
    this.generation++;
    this.abort?.abort();
    this.abort = null;
    this.source?.close();
    this.source = null;
    clearInterval(this.watchdog);
    clearTimeout(this.retry);
    clearInterval(this.retryTicker);
    this.retryAt = 0;
  }

  private connect(immediate = false) {
    if (!this.enabled) return;
    if (!navigator.onLine) {
      this.publish(this.current ? 'stale' : 'offline', t('network.offline'));
      return;
    }
    this.disconnectTransport();
    const generation = this.generation;
    this.publish(this.current ? 'stale' : 'connecting', this.current ? t('network.reconnecting') : t('network.connecting'));

    const abort = this.abort = new AbortController();
    const timeout = window.setTimeout(() => abort.abort(), immediate ? 12000 : 15000);
    void fetch('/plant/api/session', {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: abort.signal,
    }).then(async response => {
      if (generation !== this.generation) return;
      if (response.status === 401 || response.status === 403) {
        this.disconnectTransport();
        this.publish('auth', t('network.auth'));
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const session = await response.json();
      if (generation !== this.generation) return;
      if (session.mode !== 'simulation' || !frame(session.frame)) throw new Error('invalid-frame');
      this.attempt = 0;
      this.accept(session.frame);

      const source = this.source = new EventSource('/plant/api/stream');
      source.addEventListener('frame', event => {
        if (generation !== this.generation) return;
        try {
          const value: unknown = JSON.parse((event as MessageEvent).data);
          if (!frame(value)) throw new Error();
          this.accept(value);
        } catch {
          this.fail('Invalid telemetry frame');
        }
      });
      source.onerror = () => { if (generation === this.generation) this.fail(t('network.reconnecting')); };
      this.watchdog = window.setInterval(() => {
        if (Date.now() - this.lastSeenAt > 18000) this.fail(t('network.reconnecting'));
      }, 2000);
    }).catch(error => {
      if (generation !== this.generation) return;
      const message = error instanceof DOMException && error.name === 'AbortError' ? t('network.reconnecting') : t('network.reconnecting');
      this.fail(message);
    }).finally(() => clearTimeout(timeout));
  }

  private accept(value: Frame) {
    if (this.current?.runId === value.runId && value.seq < this.current.seq) return;
    this.lastSeenAt = Date.now();
    this.current = value;
    this.attempt = 0;
    this.publish('live', '');
  }

  private fail(message: string) {
    if (!this.enabled) return;
    this.disconnectTransport();
    const state: StreamState = this.current ? 'stale' : navigator.onLine ? 'connecting' : 'offline';
    if (!navigator.onLine) {
      this.publish(state, t('network.offline'));
      return;
    }
    const delay = this.retrySteps[Math.min(this.attempt++, this.retrySteps.length - 1)];
    this.retryAt = Date.now() + delay;
    this.publish(state, message, delay);
    this.retryTicker = window.setInterval(() => {
      const remaining = Math.max(0, this.retryAt - Date.now());
      this.publish(state, message, remaining);
    }, 1000);
    this.retry = window.setTimeout(() => this.connect(), delay);
  }
}
