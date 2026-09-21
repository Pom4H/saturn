import webpush from 'web-push';
import { createHash } from 'node:crypto';
import type { Actor } from '../types';
import { failCode } from '../diagnostics';
import type { Store } from '../store';
export const allowedPushEndpoint = (endpoint: string): boolean => {
    try {
        const url = new URL(endpoint);
        return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && !url.hash && (url.hostname === 'fcm.googleapis.com' || url.hostname === 'updates.push.services.mozilla.com' || url.hostname === 'web.push.apple.com' || url.hostname.endsWith('.push.apple.com') || url.hostname.endsWith('.notify.windows.com'));
    }
    catch {
        return false;
    }
};
export class Push {
    private busy = false;
    readonly keys: {
        publicKey: string;
        privateKey: string;
    };
    constructor(readonly store: Store, private subject: string, private send: typeof webpush.sendNotification = webpush.sendNotification) {
        if (!/^mailto:[^\s@]+@[^\s@]+$/.test(subject) && !/^https:\/\//.test(subject))
            failCode('SATURN_VALUE_INVALID',{field:'push.subject',reason:'invalid'});
        this.keys = store.meta('vapid', null) ?? webpush.generateVAPIDKeys();
        store.set('vapid', this.keys);
    }
    subscribe(value: unknown, actor: Actor, sessionId: string) {
        const sub = value as webpush.PushSubscription;
        if (!sub || typeof sub.endpoint !== 'string' || sub.endpoint.length > 2048 || !allowedPushEndpoint(sub.endpoint) || !sub.keys || !/^[A-Za-z0-9_-]{87}$/.test(sub.keys.p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(sub.keys.auth))
            failCode('SATURN_VALUE_INVALID',{field:'push.subscription',reason:'invalid'});
        const previous = this.store.db.all<{
            user_id: string;
        }>('SELECT user_id FROM subscriptions WHERE endpoint=?', [sub.endpoint])[0];
        if (previous && previous.user_id !== actor.id)
            failCode('SATURN_CONFLICT',{resource:'push.subscription',reason:'stateChanged'},{actor:actor.id},{status:409});
        if (!previous && this.store.db.all('SELECT endpoint FROM subscriptions WHERE user_id=?', [actor.id]).length >= 5)
            failCode('SATURN_LIMIT',{resource:'push.subscriptions',reason:'tooMany'},{max:5,actor:actor.id},{status:429});
        this.store.db.exec('INSERT INTO subscriptions VALUES(?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET session_id=excluded.session_id,subscription=excluded.subscription', [sub.endpoint, actor.id, sessionId, JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys })]);
        return { subscribed: true };
    }
    unsubscribe(endpoint: string, actor: Actor) { this.store.db.exec('DELETE FROM subscriptions WHERE endpoint=? AND user_id=?', [endpoint, actor.id]); }
    async flush(now = Date.now()) {
        if (this.busy)
            return;
        this.busy = true;
        try {
            this.store.db.transaction(() => { const events = this.store.db.all<{
                id: string;
                time: number;
            }>("SELECT id,time FROM outbox WHERE status='pending' LIMIT 50"); for (const event of events) {
                const subscribers = now - event.time < 3600000 ? this.store.db.all<{
                    endpoint: string;
                }>('SELECT p.endpoint FROM subscriptions p JOIN users u ON u.id=p.user_id') : [];
                for (const sub of subscribers)
                    this.store.db.exec('INSERT OR IGNORE INTO deliveries(event_id,endpoint) VALUES(?,?)', [event.id, sub.endpoint]);
                this.store.db.exec("UPDATE outbox SET status=? WHERE id=?", [subscribers.length ? 'queued' : 'skipped', event.id]);
            } });
            const deliveries = this.store.db.all<{
                event_id: string;
                endpoint: string;
                attempts: number;
                subscription: string;
                kind: string;
                subject: string;
            }>(`SELECT d.*,p.subscription,o.kind,o.subject FROM deliveries d JOIN subscriptions p ON p.endpoint=d.endpoint JOIN users u ON u.id=p.user_id JOIN outbox o ON o.id=d.event_id WHERE d.status='pending' AND d.next_at<=? LIMIT 20`, [now]);
            for (const row of deliveries) {
                // The lock-screen payload deliberately contains no process values, project source or report data.
                const payload = JSON.stringify({ title: row.kind === 'alarm' ? 'SCADA · новый аларм' : 'SCADA · отчёт готов', body: 'Откройте приложение для просмотра.', tag: row.event_id, url: `./app/#${row.kind === 'alarm' ? 'alarms' : 'reports'}` });
                try {
                    await this.send(JSON.parse(row.subscription), payload, { vapidDetails: { subject: this.subject, ...this.keys }, TTL: 300, urgency: row.kind === 'alarm' ? 'high' : 'normal', topic: createHash('sha256').update(row.event_id).digest('base64url').slice(0, 32), timeout: 5000 });
                    this.store.db.exec("UPDATE deliveries SET status='accepted',attempts=attempts+1 WHERE event_id=? AND endpoint=?", [row.event_id, row.endpoint]);
                }
                catch (error) {
                    const status = (error as {
                        statusCode?: number;
                    }).statusCode;
                    if (status === 404 || status === 410) {
                        this.store.db.exec('DELETE FROM subscriptions WHERE endpoint=?', [row.endpoint]);
                        this.store.db.exec("UPDATE deliveries SET status='expired' WHERE event_id=? AND endpoint=?", [row.event_id, row.endpoint]);
                    }
                    else
                        this.store.db.exec('UPDATE deliveries SET status=?,attempts=attempts+1,next_at=? WHERE event_id=? AND endpoint=?', [row.attempts >= 4 ? 'failed' : 'pending', now + Math.min(300000, 1000 * 2 ** row.attempts), row.event_id, row.endpoint]);
                }
            }
        }
        finally {
            this.busy = false;
        }
    }
}
