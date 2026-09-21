import { evaluate } from './kernel';
import type { AlarmRule, AlarmState, Frame, Event, Actor } from './types';
import { failCode } from './diagnostics';
export const newAlarm = (id: string): AlarmState => ({ id, active: false, acknowledged: true, pendingSince: null, raisedAt: null, clearedAt: null, acknowledgedAt: null, actor: null, quality: 'good', episode: 0 });
export function updateAlarms(rules: AlarmRule[], states: Record<string, AlarmState>, frame: Frame): Event[] {
    const events: Event[] = [];
    for (const r of rules) {
        const s = states[r.id] ?? (states[r.id] = newAlarm(r.id));
        const sample = evaluate(r.signal, id => frame.samples[id], frame.time);
        s.quality = sample.quality;
        if (sample.quality !== 'good' || sample.value === null) {
            s.pendingSince = null;
            continue;
        }
        let type = '';
        if (!s.active) {
            if (sample.value > r.above) {
                s.pendingSince ??= frame.time;
                if (frame.time - s.pendingSince >= r.delay) {
                    s.active = true;
                    s.acknowledged = false;
                    s.raisedAt = frame.time;
                    s.clearedAt = null;
                    s.acknowledgedAt = null;
                    s.actor = null;
                    s.episode++;
                    s.pendingSince = null;
                    type = 'alarm.raised';
                }
            }
            else
                s.pendingSince = null;
        }
        else if (sample.value <= r.clearBelow) {
            s.active = false;
            s.clearedAt = frame.time;
            s.pendingSince = null;
            type = 'alarm.cleared';
        }
        if (type)
            events.push({ id: `${frame.runId}:${frame.seq}:${r.id}:${type}`, runId: frame.runId, time: frame.time, type, subject: r.id, detail: r.title });
    }
    return events;
}
export function acknowledge(states: Record<string, AlarmState>, id: string, actor: Actor, time: number): AlarmState { const s = states[id]; if (!s || s.raisedAt === null)
    failCode('SATURN_RUNTIME_INVALID',{reason:'stateChanged'},{resource:'alarm',id}); if (!s.acknowledged) {
    s.acknowledged = true;
    s.actor = actor.id;
    s.acknowledgedAt = time;
} return s; }
