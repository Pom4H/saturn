import type { Frame } from '../plant/types';
export type StreamState = 'connecting' | 'live' | 'stale' | 'offline' | 'auth';
export interface TelemetryUpdate { state: StreamState; frame: Frame | null; message: string; }
function frame(value: unknown): value is Frame {
  if (!value || typeof value !== 'object') return false;
  const v = value as Frame;
  return v.synthetic === true && typeof v.runId === 'string' && typeof v.revision === 'string' && Number.isSafeInteger(v.seq) && v.seq >= 0 && Number.isFinite(v.time) && typeof v.paused === 'boolean' && !!v.samples && typeof v.samples === 'object' && !Array.isArray(v.samples) && Array.isArray(v.alarms);
}
/** Same-origin authenticated simulation stream; no state or credentials are persisted. */
export class SimulationStream {
  private source: EventSource | null = null;
  private generation = 0;
  private watchdog = 0;
  private retry = 0;
  private lastSeen = 0;
  private current: Frame | null = null;
  private enabled = false;
  private abort: AbortController | null = null;
  private attempt = 0;
  private readonly retrySteps = [1000, 2000, 5000, 10000];
  constructor(private readonly update: (update: TelemetryUpdate) => void) {
    window.addEventListener('online', () => { if (this.enabled) this.connect(); });
    window.addEventListener('offline', () => {
      if (!this.enabled) return;
      this.disconnectTransport();
      this.publish(this.current ? 'stale' : 'offline', 'Сеть недоступна');
    });
    window.addEventListener('pagehide', () => this.disconnectTransport());
    window.addEventListener('pageshow', event => { if (event.persisted && this.enabled) this.connect(); });
  }
  start(initial?: Frame | null) {
    if (initial && frame(initial)) { this.current = initial; this.lastSeen = Date.now(); }
    if (this.enabled) return;
    this.enabled = true; this.attempt = 0; this.connect();
  }
  stop() { this.enabled = false; this.disconnectTransport(); this.current = null; this.lastSeen = 0; this.attempt = 0; }
  private publish(state: StreamState, message: string) { this.update({ state, frame: this.current, message }); }
  private disconnectTransport() {
    this.generation++; this.abort?.abort(); this.abort = null; this.source?.close(); this.source = null;
    clearInterval(this.watchdog); clearTimeout(this.retry);
  }
  private connect() {
    if (!this.enabled) return;
    if (!navigator.onLine) { this.publish(this.current ? 'stale' : 'offline', 'Сеть недоступна'); return; }
    this.disconnectTransport();
    const generation = this.generation;
    this.publish(this.current ? 'stale' : 'connecting', this.current ? 'Переподключение…' : 'Подключение к симуляции…');
    const abort = this.abort = new AbortController();
    const timeout = window.setTimeout(() => abort.abort(), 12000);
    void fetch('/plant/api/session', { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: abort.signal }).then(async response => {
      if (generation !== this.generation) return;
      if (response.status === 401 || response.status === 403) {
        this.disconnectTransport(); this.publish('auth', 'Войдите на сервер для получения данных'); return;
      }
      if (!response.ok) throw new Error(`Симуляция недоступна (HTTP ${response.status})`);
      const session = await response.json();
      if (generation !== this.generation) return;
      if (session.mode !== 'simulation' || !frame(session.frame)) throw new Error('Сервер не предоставил кадр симуляции');
      this.accept(session.frame);
      const source = this.source = new EventSource('/plant/api/stream');
      source.addEventListener('frame', event => {
        if (generation !== this.generation) return;
        try { const value: unknown = JSON.parse((event as MessageEvent).data); if (!frame(value)) throw new Error(); this.accept(value); }
        catch { this.fail('Неверный кадр симуляции'); }
      });
      source.onerror = () => { if (generation === this.generation) this.fail('Соединение с симуляцией потеряно'); };
      this.watchdog = window.setInterval(() => { if (Date.now() - this.lastSeen > 18000) this.fail('Сервер перестал обновлять данные'); }, 2000);
    }).catch(error => { if (generation === this.generation) this.fail(error instanceof Error ? error.message : 'Симуляция недоступна'); }).finally(() => clearTimeout(timeout));
  }
  private accept(value: Frame) {
    if (this.current?.runId === value.runId && value.seq < this.current.seq) return;
    this.lastSeen = Date.now(); this.current = value; this.attempt = 0;
    this.publish('live', '');
  }
  private fail(message: string) {
    if (!this.enabled) return;
    this.disconnectTransport();
    const state: StreamState = this.current ? 'stale' : navigator.onLine ? 'connecting' : 'offline';
    this.publish(state, message);
    if (!navigator.onLine) return;
    const delay = this.retrySteps[Math.min(this.attempt++, this.retrySteps.length - 1)];
    this.retry = window.setTimeout(() => this.connect(), delay);
  }
}
