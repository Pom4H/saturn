import type { Frame } from '../plant/types';
export type StreamState = 'connecting' | 'live' | 'offline' | 'auth';
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
  private timer = 0;
  private retry = 0;
  private lastSeen = 0;
  private current: Frame | null = null;
  private enabled = false;
  private abort: AbortController | null = null;
  constructor(private readonly update: (update: TelemetryUpdate) => void) {
    window.addEventListener('online', () => { if (this.enabled) this.connect(); });
    window.addEventListener('offline', () => { if (this.enabled) { this.disconnect(); this.update({ state: 'offline', frame: null, message: 'Сеть недоступна' }); } });
    window.addEventListener('pagehide', () => this.disconnect());
    window.addEventListener('pageshow', event => { if (event.persisted && this.enabled) this.connect(); });
  }
  start() { if (this.enabled) return; this.enabled = true; this.connect(); }
  stop() { this.enabled = false; this.disconnect(); this.current = null; }
  private disconnect() { this.generation++; this.abort?.abort(); this.abort = null; this.source?.close(); this.source = null; clearInterval(this.timer); clearTimeout(this.retry); }
  private connect() {
    this.disconnect();
    const generation = this.generation;
    this.update({ state: 'connecting', frame: null, message: 'Подключение к симуляции…' });
    const abort = this.abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 12000);
    void fetch('/plant/api/session', { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: abort.signal }).then(async response => {
      if (generation !== this.generation) return;
      if (response.status === 401 || response.status === 403) {
        this.update({ state: 'auth', frame: null, message: 'Войдите на сервер для получения данных' });
        this.retry = window.setTimeout(() => this.connect(), 10000); return;
      }
      if (!response.ok) throw new Error(`Симуляция недоступна (HTTP ${response.status})`);
      const session = await response.json();
      if (generation !== this.generation) return;
      if (session.mode !== 'simulation' || !frame(session.frame)) throw new Error('Сервер не предоставил кадр симуляции');
      this.current = null;
      this.accept(session.frame);
      const source = this.source = new EventSource('/plant/api/stream');
      source.addEventListener('frame', event => {
        if (generation !== this.generation) return;
        try { const value: unknown = JSON.parse((event as MessageEvent).data); if (!frame(value)) throw new Error(); this.accept(value); }
        catch { this.fail('Неверный кадр симуляции'); }
      });
      source.onerror = () => { if (generation === this.generation) this.fail('Соединение с симуляцией потеряно'); };
      this.timer = window.setInterval(() => { if (Date.now() - this.lastSeen > 18000) this.fail('Сервер перестал обновлять данные'); }, 2000);
    }).catch(error => { if (generation === this.generation) this.fail(error instanceof Error ? error.message : 'Симуляция недоступна'); }).finally(() => clearTimeout(timeout));
  }
  private accept(value: Frame) {
    if (this.current?.runId === value.runId && value.seq < this.current.seq) return;
    this.lastSeen = Date.now(); this.current = value;
    this.update({ state: 'live', frame: value, message: '' });
  }
  private fail(message: string) {
    this.disconnect();
    this.update({ state: 'offline', frame: null, message });
    if (this.enabled) this.retry = window.setTimeout(() => this.connect(), 3000);
  }
}
